import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import axios from 'axios';
import { z } from 'zod'; // For runtime type validation
import fs from 'fs/promises';
import cors from 'cors';

// Custom validators and constants
const isHexString = (str: string) => /^0x[0-9a-fA-F]*$/.test(str);
const isAddress = (str: string) => isHexString(str) && str.length === 42; // 0x + 40 chars (20 bytes)
const isHash = (str: string) => isHexString(str) && str.length === 66;    // 0x + 64 chars (32 bytes)
const is64ByteHex = (str: string) => isHexString(str) && str.length === 130;  // 0x + 128 chars (64 bytes)
const isEmptyHex = (str: string) => str === '0x';
const isNumericString = (str: string) => /^-?\d+$/.test(str);
const isNumericOrHexString = (str: string) => isNumericString(str) || isHexString(str);
const UINT32_MAX = 4294967295; // 2^32 - 1

const numericOrHexSchema = z.string().refine(isNumericOrHexString, {
    message: 'Must be either a numeric string or a hex string with 0x prefix'
});

const addressSchema = z.string().refine(isAddress, {
    message: 'Must be a valid Ethereum address (0x prefix + 20 bytes)'
});

const hashSchema = z.string().refine(isHash, {
    message: 'Must be a valid hash (0x prefix + 32 bytes)'
});

// Type definitions
const MandateSchema = z.object({
    chainId: z.number()
        .int()
        .min(1)
        .max(UINT32_MAX)
        .refine(
            n => n >= 1 && n <= UINT32_MAX,
            `Chain ID must be between 1 and ${UINT32_MAX}`
        ),
    tribunal: addressSchema,
    recipient: addressSchema,
    expires: numericOrHexSchema,
    token: addressSchema,
    minimumAmount: numericOrHexSchema,
    baselinePriorityFee: numericOrHexSchema,
    scalingFactor: numericOrHexSchema,
    salt: hashSchema
});

const CompactMessageSchema = z.object({
    arbiter: addressSchema,
    sponsor: addressSchema,
    nonce: hashSchema,
    expires: numericOrHexSchema,
    id: numericOrHexSchema,
    amount: numericOrHexSchema,
    mandate: MandateSchema
});

const ContextSchema = z.object({
    dispensation: numericOrHexSchema,
    dispensationUSD: z.string(),
    spotOutputAmount: numericOrHexSchema,
    quoteOutputAmountDirect: numericOrHexSchema,
    quoteOutputAmountNet: numericOrHexSchema,
    deltaAmount: numericOrHexSchema.optional(),
    slippageBips: z.number()
        .int()
        .min(0)
        .max(10000)
        .refine(
            n => n >= 0 && n <= 10000,
            'Slippage must be between 0 and 10000 basis points'
        )
        .optional(),
    witnessTypeString: z.string(),
    witnessHash: hashSchema,
    claimHash: hashSchema.optional()
});

const BroadcastRequestSchema = z.object({
    chainId: numericOrHexSchema,
    compact: CompactMessageSchema,
    sponsorSignature: z.string()
        .refine(
            str => str === null || isEmptyHex(str) || is64ByteHex(str),
            'Sponsor signature must be null, 0x, or a 64-byte hex string'
        )
        .nullable(),
    allocatorSignature: z.string()
        .refine(
            is64ByteHex,
            'Allocator signature must be a 64-byte hex string'
        ),
    context: ContextSchema,
    claimHash: hashSchema.optional()
});

interface Config {
    endpoints: string[];
    port: number;
}

// Define types for error logging
interface HttpFailureDetails {
    endpoint: string;
    status?: number;
    statusText?: string;
    message?: string;
    data?: any;
    config?: {
        url?: string;
        method?: string;
        headers?: any;
    };
    error?: string;
}

interface WsFailureDetails {
    message: string;
    stack?: string;
    name?: string;
}

const app = express();
app.use(cors());
app.use(express.json());

// Store connected WebSocket clients
const clients = new Set<WebSocket>();

async function loadConfig(): Promise<Config> {
    try {
        const configFile = await fs.readFile('config.json', 'utf-8');
        try {
            const config = JSON.parse(configFile);
            
            // Validate config structure
            if (!config.endpoints || !Array.isArray(config.endpoints)) {
                throw new Error('Config must contain an endpoints array');
            }
            
            if (typeof config.port !== 'number') {
                throw new Error('Config must contain a valid port number');
            }
            
            return config;
        } catch (parseError) {
            console.error('Failed to parse config.json:', JSON.stringify({
                message: parseError instanceof Error ? parseError.message : String(parseError),
                stack: parseError instanceof Error ? parseError.stack : undefined,
                configContent: configFile
            }, null, 2));
            throw new Error('Invalid JSON in config file');
        }
    } catch (readError) {
        console.error('Failed to read config.json:', JSON.stringify({
            message: readError instanceof Error ? readError.message : String(readError),
            stack: readError instanceof Error ? readError.stack : undefined
        }, null, 2));
        throw new Error('Could not read config file');
    }
}

async function initializeServer() {
    const config = await loadConfig();

    // Initialize WebSocket server
    const wss = new WebSocketServer({ noServer: true });

    wss.on('connection', (ws) => {
        clients.add(ws);
        console.log('Client connected');

        ws.on('close', () => {
            clients.delete(ws);
            console.log('Client disconnected');
        });
    });

    // Broadcast to all connected WebSocket clients
    function broadcast(data: unknown) {
        const message = JSON.stringify(data);
        clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    // Validation middleware
    function validatePayload(req: express.Request, res: express.Response, next: express.NextFunction) {
        try {
            BroadcastRequestSchema.parse(req.body);
            next();
        } catch (error) {
            // Enhanced validation error logging
            if (error instanceof z.ZodError) {
                console.error('Validation error:', JSON.stringify({
                    issues: error.issues,
                    path: req.path,
                    method: req.method,
                    body: req.body
                }, null, 2));
            } else {
                console.error('Unexpected validation error:', JSON.stringify({
                    error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
                    path: req.path,
                    method: req.method
                }, null, 2));
            }
            
            res.status(400).json({
                success: false,
                error: 'Invalid payload',
                details: error
            });
        }
    }

    // Main broadcast endpoint
    app.post('/broadcast', validatePayload, async (req, res) => {
        try {
            // Create promises for both HTTP POSTs and WebSocket broadcasts
            const httpPromises = config.endpoints.map(endpoint =>
                axios.post(endpoint, req.body, {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                })
            );

            // Create WebSocket broadcast promises
            const wsPromises = Array.from(clients)
                .filter(client => client.readyState === WebSocket.OPEN)
                .map(client => new Promise<void>((resolve, reject) => {
                    try {
                        client.send(JSON.stringify(req.body), (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    } catch (err) {
                        reject(err);
                    }
                }));

            // Wait for all operations to complete
            const results = await Promise.allSettled([...httpPromises, ...wsPromises]);

            // Separate and check HTTP and WS failures
            const httpResults = results.slice(0, httpPromises.length);
            const wsResults = results.slice(httpPromises.length);

            const httpFailures = httpResults.filter((result): result is PromiseRejectedResult =>
                result.status === 'rejected'
            );

            const wsFailures = wsResults.filter((result): result is PromiseRejectedResult =>
                result.status === 'rejected'
            );

            if (httpFailures.length > 0 || wsFailures.length > 0) {
                // Enhanced error logging for HTTP failures
                const detailedHttpFailures: HttpFailureDetails[] = [];
                httpResults.forEach((result, originalIndex) => {
                    if (result.status === 'rejected') {
                        const error = result.reason;
                        const endpoint = config.endpoints[originalIndex];
                        
                        if (axios.isAxiosError(error)) {
                            detailedHttpFailures.push({
                                endpoint: endpoint,
                                status: error.response?.status,
                                statusText: error.response?.statusText,
                                message: error.message,
                                data: error.response?.data,
                                config: {
                                    url: error.config?.url,
                                    method: error.config?.method,
                                    headers: error.config?.headers,
                                }
                            });
                        } else {
                            detailedHttpFailures.push({
                                endpoint: endpoint,
                                error: error instanceof Error ? error.message : String(error)
                            });
                        }
                    }
                });

                // Enhanced error logging for WebSocket failures
                const detailedWsFailures: WsFailureDetails[] = wsFailures.map((failure) => {
                    const error = failure.reason;
                    return {
                        message: error instanceof Error ? error.message : String(error),
                        stack: error instanceof Error ? error.stack : undefined,
                        name: error instanceof Error ? error.name : undefined
                    };
                });

                // Use JSON.stringify to ensure deep serialization of nested objects
                console.error('Some operations failed:', JSON.stringify({
                    httpFailures: detailedHttpFailures,
                    wsFailures: detailedWsFailures
                }, null, 2));
            }

            // Return detailed status
            res.status(200).json({
                success: true,
                results: {
                    http: {
                        total: httpPromises.length,
                        failures: httpFailures.length
                    },
                    websocket: {
                        total: wsPromises.length,
                        failures: wsFailures.length
                    }
                }
            });

        } catch (error) {
            // Enhanced error logging for the overall request
            if (axios.isAxiosError(error)) {
                console.error('Error processing broadcast (Axios error):', JSON.stringify({
                    message: error.message,
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data,
                    config: {
                        url: error.config?.url,
                        method: error.config?.method,
                        headers: error.config?.headers,
                    }
                }, null, 2));
            } else {
                console.error('Error processing broadcast:', JSON.stringify(
                    error instanceof Error 
                        ? { message: error.message, stack: error.stack } 
                        : error
                , null, 2));
            }
            
            res.status(500).json({
                success: false,
                error: 'Failed to process broadcast request',
                details: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    // Error handling middleware
    app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
        // Enhanced global error logging
        if (axios.isAxiosError(err)) {
            console.error('Unhandled Axios error:', JSON.stringify({
                message: err.message,
                status: err.response?.status,
                statusText: err.response?.statusText,
                data: err.response?.data,
                config: {
                    url: err.config?.url,
                    method: err.config?.method,
                    headers: err.config?.headers,
                },
                stack: err.stack
            }, null, 2));
        } else {
            console.error('Unhandled error:', JSON.stringify({
                message: err.message,
                stack: err.stack,
                name: err.name,
                // Include request information for context
                path: req.path,
                method: req.method,
                body: req.body,
                query: req.query
            }, null, 2));
        }
        
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: err.message
        });
    });

    // Start the server
    const server = app.listen(config.port, () => {
        console.log(`Server running on port ${config.port}`);
        console.log(`Configured endpoints: ${config.endpoints.join(', ')}`);
        console.log(`WebSocket server available at ws://localhost:${config.port}/ws`);
    });

    // Add error handler for the HTTP server
    server.on('error', (error) => {
        console.error('HTTP server error:', JSON.stringify({
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            code: (error as NodeJS.ErrnoException).code
        }, null, 2));
        
        // Handle specific error codes
        if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
            console.error(`Port ${config.port} is already in use. Please choose a different port.`);
        }
        
        process.exit(1);
    });

    // Handle WebSocket upgrade requests
    server.on('upgrade', (request, socket, head) => {
        if (request.url === '/ws') {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        } else {
            socket.destroy();
        }
    });
}

// Initialize the server
initializeServer().catch(error => {
    console.error('Server initialization failed:', JSON.stringify({
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined
    }, null, 2));
    process.exit(1);
});
