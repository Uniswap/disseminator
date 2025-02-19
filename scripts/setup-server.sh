#!/bin/bash

# Check if domain and IP are provided
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <domain> <ip>"
    echo "Example: $0 compactx-disseminator.com 157.230.65.211"
    exit 1
fi

DOMAIN=$1
IP=$2
PROJECT_DIR="/opt/disseminator"

# Update system and install dependencies
echo "Updating system and installing dependencies..."
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y curl git nginx certbot python3-certbot-nginx

# Install Node.js 20.x
echo "Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Create project directory and set permissions
echo "Setting up project directory..."
sudo mkdir -p $PROJECT_DIR
sudo chown -R $USER:$USER $PROJECT_DIR

# Clone the repository
echo "Cloning repository..."
git clone https://github.com/0age/disseminator.git $PROJECT_DIR
cd $PROJECT_DIR

# Install dependencies and build
echo "Installing dependencies and building..."
npm install
npm run build

# Create systemd service
echo "Creating systemd service..."
sudo tee /etc/systemd/system/disseminator.service > /dev/null << EOL
[Unit]
Description=Disseminator WebSocket Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=disseminator

[Install]
WantedBy=multi-user.target
EOL

# Configure nginx
echo "Configuring nginx..."
sudo tee /etc/nginx/sites-available/disseminator > /dev/null << EOL
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    '' close;
}

server {
    server_name $DOMAIN;
    listen 80;
    listen [::]:80;

    location /broadcast {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOL

# Enable nginx site
sudo ln -sf /etc/nginx/sites-available/disseminator /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Update DNS A record
echo "Please ensure the following DNS record is set:"
echo "$DOMAIN. A $IP"
echo "Press Enter when DNS is configured..."
read

# Set up SSL with Let's Encrypt
echo "Setting up SSL certificate..."
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email 0age@protonmail.com

# Start services
echo "Starting services..."
sudo systemctl daemon-reload
sudo systemctl enable disseminator
sudo systemctl start disseminator
sudo systemctl restart nginx

echo "Setup complete!"
echo "Your server is now running at https://$DOMAIN"
echo "WebSocket endpoint: wss://$DOMAIN/ws"
echo "Broadcast endpoint: https://$DOMAIN/broadcast"
echo ""
echo "You can monitor the server with:"
echo "sudo systemctl status disseminator"
echo "sudo journalctl -u disseminator -f"
