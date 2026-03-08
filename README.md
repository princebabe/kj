# TempMail Pro

A modern, full-stack **Temporary Email** web application with a premium landing page, real-time inbox dashboard, RESTful backend API, and a complete admin panel.

---

## Quick Start

### Prerequisites
- **Node.js ≥ 22** (uses built-in `node:sqlite`)

### 1. Install backend dependencies

```bash
cd backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env to set JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, etc.
```

### 3. Seed the default superadmin user

```bash
cd backend
node seed.js
```

Default credentials (from `.env.example`):
- **Email:** `admin@tempmailpro.local`
- **Password:** `Admin@1234!`

### 4. Start the server

```bash
# Production
npm start

# Development (with auto-reload)
npm run dev
```

The server starts on **http://localhost:3000** and serves:
- 🌐 **Frontend:**  http://localhost:3000/
- 🛡  **Admin Panel:** http://localhost:3000/admin/
- 📬 **API v1:**   http://localhost:3000/api/v1/info

---

## Architecture

```
kj/
├── index.html              # Frontend landing page + inbox dashboard
├── admin/                  # Admin panel (HTML/CSS/JS)
│   ├── index.html          # Admin login
│   ├── dashboard.html      # Stats, charts, recent activity
│   ├── users.html          # User management
│   ├── emails.html         # Temp email management
│   ├── messages.html       # Message management
│   ├── domains.html        # Domain management
│   ├── settings.html       # App settings + broadcast
│   ├── audit.html          # Audit log viewer
│   └── assets/
│       ├── admin.css       # Admin panel styles
│       └── admin.js        # Shared JS (auth, API client, helpers)
├── assets/                 # Frontend assets (Tailwind CSS, Font Awesome, QR code)
│   ├── css/
│   └── webfonts/
└── backend/
    ├── server.js           # Express app entry point
    ├── seed.js             # Create default admin user
    ├── .env.example        # Environment variable template
    ├── db/
    │   └── database.js     # SQLite schema + migrations
    ├── middleware/
    │   ├── auth.js         # JWT authentication + role guards
    │   └── rateLimiter.js  # Rate limiting
    └── routes/
        ├── auth.js         # POST /api/auth/login|register|me
        ├── emails.js       # POST/GET/DELETE /api/emails
        ├── inbox.js        # GET/DELETE /api/inbox/:address
        ├── admin.js        # Admin-only: dashboard, users, domains, settings, audit
        └── api.js          # Public developer API v1
```

---

## API Reference

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new account |
| POST | `/api/auth/login` | Login, returns JWT |
| GET  | `/api/auth/me` | Get current user (JWT required) |
| POST | `/api/auth/change-password` | Change password (JWT required) |

### Temp Emails

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/emails/generate` | Generate a new temp email |
| GET  | `/api/emails` | List your emails (JWT required) |
| DELETE | `/api/emails/:id` | Delete temp email (JWT required) |

### Inbox (public – just know the address)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/inbox/:address` | List messages in inbox |
| GET | `/api/inbox/:address/:msgId` | Read a message |
| DELETE | `/api/inbox/:address/:msgId` | Delete a message |
| POST | `/api/inbox/receive` | Webhook for incoming mail (secret required) |

### Admin API (admin role required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/dashboard` | Dashboard stats + recent data |
| GET/POST | `/api/admin/users` | List / create users |
| PATCH | `/api/admin/users/:id/status` | Ban / suspend user |
| PATCH | `/api/admin/users/:id/role` | Change user role |
| DELETE | `/api/admin/users/:id` | Delete user |
| GET/POST | `/api/admin/domains` | List / add domains |
| PATCH | `/api/admin/domains/:id` | Enable/disable domain |
| DELETE | `/api/admin/domains/:id` | Delete domain |
| GET | `/api/admin/emails` | All temp emails |
| DELETE | `/api/admin/emails/:id` | Delete temp email |
| GET | `/api/admin/messages` | All messages |
| DELETE | `/api/admin/messages/:id` | Delete message |
| GET/PUT | `/api/admin/settings` | Read / update global settings |
| GET | `/api/admin/audit` | Audit log |
| POST | `/api/admin/broadcast` | Send email to all users |
| GET | `/api/admin/system` | Server info (superadmin only) |

### Developer API v1 (API key or JWT)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/info` | API info |
| GET | `/api/v1/domains` | List available domains |
| POST | `/api/v1/email/generate` | Generate temp email |
| GET | `/api/v1/inbox/:address` | Read inbox |
| DELETE | `/api/v1/inbox/:address` | Delete inbox |

Pass your API key via header: `X-API-Key: <your_key>`

---

## Admin Panel

Navigate to **http://localhost:3000/admin** and sign in with your admin credentials.

### Features
- 📊 **Dashboard** – Live statistics with 7-day bar charts, recent emails, recent activity feed, new user table
- 👥 **User Management** – Search, filter by role/status, ban/unban, promote to admin, delete, create new users
- 📬 **Temp Email Management** – Browse all temporary email addresses, delete, filter by status
- 📥 **Message Management** – View all received messages, filter by spam/clean, delete
- 🌐 **Domain Management** – Add/remove domains, toggle active/private with live toggle switches
- ⚙️ **Settings** – Global settings form with toggles, broadcast email to all users, system info panel
- 📋 **Audit Log** – Full activity history with action, user, target, IP, and timestamp

---

## Security

- Passwords hashed with bcrypt (cost factor 12)
- JWT authentication with configurable expiry
- Role-based access control (`user`, `admin`, `superadmin`)
- Helmet.js security headers
- Rate limiting (general + strict auth + email generation)
- Input validation via express-validator
- Audit logging for all sensitive actions
- CORS protection with configurable origin
