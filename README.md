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
    "port": 3000
}
```

- `endpoints`: Array of HTTP endpoints to broadcast messages to
- `port`: Server port for both HTTP and WebSocket connections

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
wscat -c ws://localhost:3000/ws
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
        "id": "23499701752147396106288076033874150844871292959348239827687418423535067463557",
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
        "dispensationUSD": "$1000.00",
        "spotOutputAmount": "1000000000000000000",
        "quoteOutputAmountDirect": "1000000000000000000",
        "quoteOutputAmountNet": "990000000000000000",
        "deltaAmount": "-95889553740141",
        "witnessTypeString": "test",
        "witnessHash": "0x1234567890123456789012345678901234567890123456789012345678901234",
        "claimHash": "0x1234567890123456789012345678901234567890123456789012345678901234"
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
  - `id`: Numeric string or hex
  - `amount`: Numeric string or hex
  - `mandate`: Mandate object
- `sponsorSignature`: 64-byte hex string, '0x', or null
- `allocatorSignature`: 64-byte hex string
- `context`: Context object
  - `dispensation`: Numeric string or hex
  - `dispensationUSD`: String (can include $ prefix)
  - `spotOutputAmount`: Numeric string or hex
  - `quoteOutputAmountDirect`: Numeric string or hex
  - `quoteOutputAmountNet`: Numeric string or hex
  - `deltaAmount`: (optional) Numeric string or hex (can be negative)
  - `slippageBips`: (optional) Number between 0-10000
  - `witnessTypeString`: String
  - `witnessHash`: 32-byte hex string
  - `claimHash`: (optional) 32-byte hex string
- `claimHash`: (optional) 32-byte hex string

Response:
```json
{
    "success": true,
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
```

### WebSocket Endpoint

Connect to `/ws` to receive real-time broadcast messages. All messages sent through the `/broadcast` endpoint will be forwarded to connected WebSocket clients.

## Deployment

The project includes a setup script for deploying to a cloud server with automatic HTTPS configuration using Let's Encrypt.

### Prerequisites

- A domain name pointing to your server (A record)
- Ubuntu-based cloud server
- SSH access to the server

### Deployment Steps

1. SSH into your server:
```bash
ssh user@your-server
```

2. Clone the repository:
```bash
git clone https://github.com/Uniswap/disseminator.git
cd disseminator
```

3. Run the setup script with your domain and IP:
```bash
./scripts/setup-server.sh your-domain.com your-server-ip
```

For example:
```bash
./setup-server.sh compactx-disseminator.com 157.230.65.211
```

The script will:
- Install required dependencies (Node.js, nginx, certbot)
- Set up the project in /opt/disseminator
- Configure nginx with WebSocket support
- Set up SSL certificates with Let's Encrypt
- Create and enable a systemd service
- Start the server

### Monitoring

Monitor the server status:
```bash
sudo systemctl status disseminator
```

View server logs:
```bash
sudo journalctl -u disseminator -f
```

### Testing Deployed Server

Test WebSocket connection:
```bash
wscat -c wss://your-domain.com/ws
```

Test broadcast endpoint:
```bash
curl -X POST https://your-domain.com/broadcast \
-H "Content-Type: application/json" \
-d '{ ... your payload ... }'
```
