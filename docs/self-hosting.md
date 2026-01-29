# Self-Hosting OpenSend

This guide covers deploying OpenSend on your own infrastructure.

---

## Prerequisites

- Docker and Docker Compose
- PostgreSQL 15+ (or use Docker image)
- A domain with DNS access
- Server with ports 25, 80, 443 accessible

**Recommended Server Specs:**
- 2+ CPU cores
- 4GB+ RAM
- 20GB+ storage
- Ubuntu 22.04 LTS or similar

---

## Quick Start

### 1. Clone Repository

```bash
git clone https://github.com/reshashi/opensend.git
cd opensend
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```bash
# Required
DATABASE_URL=postgresql://opensend:password@postgres:5432/opensend
API_SECRET=your-secret-key-here  # openssl rand -hex 32
PRIMARY_DOMAIN=mail.yourdomain.com
SMTP_HOSTNAME=mail.yourdomain.com
DKIM_SELECTOR=opensend
```

### 3. Generate DKIM Keys

```bash
mkdir -p keys
openssl genrsa -out keys/dkim-private.pem 2048
openssl rsa -in keys/dkim-private.pem -pubout -out keys/dkim-public.pem
```

### 4. Start Services

```bash
docker-compose up -d
```

### 5. Verify Installation

```bash
# Check services are running
docker-compose ps

# Check API health
curl http://localhost:3000/health
```

---

## Docker Compose Configuration

Create `docker-compose.yml` in project root:

```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: packages/api/Dockerfile
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - API_SECRET=${API_SECRET}
      - REDIS_URL=${REDIS_URL:-}
      - NODE_ENV=production
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  mcp:
    build:
      context: .
      dockerfile: packages/mcp-server/Dockerfile
    ports:
      - "3001:3001"
    environment:
      - MAILFORGE_API_URL=http://api:3000
      - MCP_PORT=3001
    depends_on:
      - api
    restart: unless-stopped

  worker:
    build:
      context: .
      dockerfile: packages/worker/Dockerfile
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL:-}
      - SMTP_HOST=haraka
      - SMTP_PORT=25
    depends_on:
      - postgres
      - redis
      - haraka
    restart: unless-stopped

  haraka:
    build:
      context: ./haraka
      dockerfile: Dockerfile
    ports:
      - "25:25"
      - "587:587"
    volumes:
      - ./keys:/app/keys:ro
      - ./haraka/config:/app/config
    environment:
      - SMTP_HOSTNAME=${SMTP_HOSTNAME}
      - DKIM_SELECTOR=${DKIM_SELECTOR}
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=opensend
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=opensend
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

---

## DNS Configuration

Configure these DNS records for your sending domain:

### MX Record (if receiving email)

```
Type: MX
Name: @
Value: mail.yourdomain.com
Priority: 10
```

### A Record

```
Type: A
Name: mail
Value: YOUR_SERVER_IP
```

### SPF Record

```
Type: TXT
Name: @
Value: v=spf1 ip4:YOUR_SERVER_IP include:_spf.opensend.dev ~all
```

### DKIM Record

```
Type: TXT
Name: opensend._domainkey
Value: v=DKIM1; k=rsa; p=YOUR_PUBLIC_KEY_HERE
```

Get your public key:

```bash
cat keys/dkim-public.pem | grep -v "PUBLIC KEY" | tr -d '\n'
```

### DMARC Record

```
Type: TXT
Name: _dmarc
Value: v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com
```

### PTR Record (Reverse DNS)

Contact your hosting provider to set:

```
YOUR_SERVER_IP -> mail.yourdomain.com
```

---

## Haraka SMTP Configuration

Haraka configuration files are in `haraka/config/`:

### haraka/config/host_list

```
mail.yourdomain.com
yourdomain.com
```

### haraka/config/smtp.ini

```ini
[main]
listen=[::]:25,[::]:587
nodes=0

[outbound]
enable_tls=true

[headers]
host_list=host_list
```

### haraka/config/dkim_sign.ini

```ini
disabled=false
selector=opensend
domain=yourdomain.com
headers_to_sign=from:to:subject:date:message-id
```

---

## SSL/TLS Configuration

### Using Let's Encrypt with Certbot

```bash
# Install certbot
apt install certbot

# Get certificate
certbot certonly --standalone -d mail.yourdomain.com

# Copy certificates for Haraka
cp /etc/letsencrypt/live/mail.yourdomain.com/fullchain.pem haraka/config/tls_cert.pem
cp /etc/letsencrypt/live/mail.yourdomain.com/privkey.pem haraka/config/tls_key.pem
```

### Haraka TLS Config (haraka/config/tls.ini)

```ini
key=/app/config/tls_key.pem
cert=/app/config/tls_cert.pem
```

---

## Database Migrations

Run migrations on first setup:

```bash
# Enter API container
docker-compose exec api sh

# Run migrations
npm run migrate
```

Or run directly:

```bash
docker-compose exec api npm run migrate
```

---

## Creating API Keys

```bash
# Generate a new API key
docker-compose exec api npm run create-api-key -- --name "My App"

# Output: mf_abc123...
```

Or via API (with admin key):

```bash
curl -X POST http://localhost:3000/v1/api-keys \
  -H "Authorization: Bearer mf_admin_key" \
  -H "Content-Type: application/json" \
  -d '{"name": "My App", "rate_limit": 1000}'
```

---

## Monitoring

### Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f api
docker-compose logs -f haraka
```

### Health Checks

```bash
# API health
curl http://localhost:3000/health

# Check email queue
docker-compose exec api npm run queue-status
```

### Prometheus Metrics (Optional)

Enable in `.env`:

```bash
METRICS_PORT=9090
```

Metrics available at `http://localhost:9090/metrics`.

---

## Backup and Recovery

### Database Backup

```bash
# Create backup
docker-compose exec postgres pg_dump -U opensend opensend > backup.sql

# Restore
docker-compose exec -T postgres psql -U opensend opensend < backup.sql
```

### Automated Backups

Add to crontab:

```bash
0 2 * * * cd /path/to/opensend && docker-compose exec -T postgres pg_dump -U opensend opensend | gzip > /backups/opensend-$(date +\%Y\%m\%d).sql.gz
```

---

## Scaling

### Horizontal Scaling

Run multiple API and worker instances:

```yaml
# docker-compose.override.yml
services:
  api:
    deploy:
      replicas: 3
  worker:
    deploy:
      replicas: 5
```

Use a load balancer (nginx, HAProxy, or cloud LB) in front of API instances.

### Redis Clustering

For high-volume deployments, consider Redis Cluster:

```bash
REDIS_URL=redis://redis-cluster:6379
```

---

## Troubleshooting

### Emails Not Sending

1. Check Haraka logs: `docker-compose logs haraka`
2. Verify DNS records: `dig TXT yourdomain.com`
3. Test SMTP: `telnet mail.yourdomain.com 25`
4. Check firewall: Port 25 must be open

### High Bounce Rate

1. Verify PTR/reverse DNS
2. Check IP reputation: [MXToolbox](https://mxtoolbox.com/blacklists.aspx)
3. Review DKIM signature: `docker-compose exec haraka haraka -c /app/config --test-dkim`

### Database Connection Issues

1. Check PostgreSQL: `docker-compose logs postgres`
2. Verify credentials in `.env`
3. Test connection: `docker-compose exec api npm run db-test`

### Rate Limiting Issues

Adjust in `.env`:

```bash
RATE_LIMIT_PER_MINUTE=500
RATE_LIMIT_PER_HOUR=5000
RATE_LIMIT_PER_DAY=50000
```

---

## Updating

```bash
# Pull latest changes
git pull origin main

# Rebuild containers
docker-compose build

# Apply database migrations
docker-compose exec api npm run migrate

# Restart services
docker-compose up -d
```

---

## Production Checklist

- [ ] SSL/TLS configured for SMTP
- [ ] DNS records (SPF, DKIM, DMARC) verified
- [ ] PTR/reverse DNS configured
- [ ] Firewall allows port 25, 587, 443
- [ ] Database backups automated
- [ ] Monitoring configured
- [ ] Log rotation enabled
- [ ] Rate limits tuned for your needs
- [ ] Webhook secret set
- [ ] API secret is strong (32+ characters)

---

## Support

- GitHub Issues: Bug reports and questions
- Documentation: [docs/](.)
- Community: GitHub Discussions

For production support, consider the hosted service at [opensend.dev](https://opensend.dev).
