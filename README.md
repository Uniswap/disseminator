# Disseminator

A TypeScript WebSocket server implementation that broadcasts messages to both HTTP endpoints and WebSocket clients. The server validates incoming messages using Zod schemas and ensures proper message delivery to all connected clients.

## Features

- Express HTTP server for receiving broadcast requests
- WebSocket server for real-time message broadcasting
- Zod schema validation for message payloads
- Concurrent HTTP and WebSocket broadcasting
- Detailed success/failure reporting

## Installation

```bash
npm install
```

## Configuration

Edit `config.json` to set your desired configuration:

```json
{
    "endpoints": [
        "https://fillanthropist.org/broadcast"
    ],
    "port": 3000,
    "wsPort": 8080
}
```

- `endpoints`: Array of HTTP endpoints to broadcast messages to
- `port`: HTTP server port
- `wsPort`: WebSocket server port

## Running the Server

Build and start the server:

```bash
# Build TypeScript
npm run build

# Start the server
npm start
```

## Testing WebSocket Functionality

You can test the WebSocket functionality using the included test client. Here's how to use it:

1. Start the server
2. Open a new terminal and run the WebSocket test client:

```bash
npm run test:ws
```

### Manual WebSocket Testing

You can also test using `wscat`, a command-line tool for WebSocket testing:

1. Install wscat globally:
```bash
npm install -g wscat
```

2. Connect to the WebSocket server:
```bash
wscat -c ws://localhost:8080
```

3. In another terminal, send a test broadcast using curl:
```bash
curl -X POST http://localhost:3000/broadcast \
-H "Content-Type: application/json" \
-d '{
    "chainId": "1",
    "compact": {
        "arbiter": "0x1234567890123456789012345678901234567890",
        "sponsor": "0x1234567890123456789012345678901234567890",
        "nonce": "0x1234567890123456789012345678901234567890123456789012345678901234",
        "expires": "1000000",
        "id": "0x1234567890123456789012345678901234567890123456789012345678901234",
        "amount": "1000000000000000000",
        "mandate": {
            "chainId": 1,
            "tribunal": "0x1234567890123456789012345678901234567890",
            "recipient": "0x1234567890123456789012345678901234567890",
            "expires": "1000000",
            "token": "0x1234567890123456789012345678901234567890",
            "minimumAmount": "1000000000000000000",
            "baselinePriorityFee": "1000000000",
            "scalingFactor": "1000000000",
            "salt": "0x1234567890123456789012345678901234567890123456789012345678901234"
        }
    },
    "sponsorSignature": null,
    "allocatorSignature": "0x1234567890123456789012345678901234567890123456789012345678901234123456789012345678901234567890123456789012345678901234567890123456",
    "context": {
        "dispensation": "1000000000000000000",
        "dispensationUSD": "1000000000",
        "spotOutputAmount": "1000000000000000000",
        "quoteOutputAmountDirect": "1000000000000000000",
        "quoteOutputAmountNet": "990000000000000000",
        "slippageBips": 100,
        "witnessTypeString": "test",
        "witnessHash": "0x1234567890123456789012345678901234567890123456789012345678901234"
    }
}'
```

You should see the broadcast message appear in your wscat terminal.

## Development

To run the server in development mode with auto-reloading:

```bash
npm run dev
```

## API Documentation

### POST /broadcast

Broadcasts a message to all configured HTTP endpoints and connected WebSocket clients.

Request body must conform to the `BroadcastRequestSchema` which includes:
- `chainId`: Chain ID (numeric string or hex)
- `compact`: Compact message object
  - `arbiter`: Ethereum address
  - `sponsor`: Ethereum address
  - `nonce`: 32-byte hex string
  - `expires`: Numeric string or hex
  - `id`: 32-byte hex string
  - `amount`: Numeric string or hex
  - `mandate`: Mandate object
- `sponsorSignature`: 64-byte hex string, '0x', or null
- `allocatorSignature`: 64-byte hex string
- `context`: Context object
- `claimHash`: (optional) 32-byte hex string

Response:
```json
{
    "status": "success",
    "results": {
        "http": {
            "total": 1,
            "failures": 0
        },
        "websocket": {
            "total": 2,
            "failures": 0
        }
    }
}
