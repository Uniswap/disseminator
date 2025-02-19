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

const app = express();
app.use(cors());
app.use(express.json());

// Store connected WebSocket clients
const clients = new Set<WebSocket>();

async function loadConfig(): Promise<Config> {
    const configFile = await fs.readFile('config.json', 'utf-8');
    return JSON.parse(configFile);
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
                console.error('Some operations failed:', {
                    httpFailures,
                    wsFailures
                });
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
            console.error('Error processing broadcast:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to process broadcast request',
                details: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    // Error handling middleware
    app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
        console.error('Unhandled error:', err);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: err.message
        });
    });

    // Start the server
    const server = app.listen(config.port, () => {
        console.log(`Server running on port ${config.port}`);
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
initializeServer().catch(console.error);
