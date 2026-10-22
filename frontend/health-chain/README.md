# Health Chain Frontend

A transparent, community-powered platform built on Stellar that connects people who need blood with donors who care. This repository contains the frontend implementation using Next.js, TypeScript, and Tailwind CSS.

## Features

### Public Interface
- Responsive Landing Page
- Engaging introduction with custom assets and typography.
- Showcased sections for organizational goals and partners.
- Interactive Step

### Admin Dashboard
- Real-time stats for Blood Units, Pending Requests, and Active Riders.
- Priority-based table view for emergency blood needs.
- Visual timeline tracking donor registrations and delivery completions.
- Interactive map interface to monitor blood deliveries in real-time with status indicators (Enroute, Picking Up, etc.).
- Responsive Sidebar

## Tech Stack

- **Framework:** [Next.js 15+](https://nextjs.org/)
- **Language:** [TypeScript](https://www.typescriptlang.org/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Icons:** [Lucide React](https://lucide.dev/)
- **Utilities:** `clsx`, `tailwind-merge` (for dynamic class handling)
- **Font:** Google Fonts (Roboto, Manrope, Poppins, DM Sans)

## Getting Started

### Prerequisites
Ensure you have Node.js installed on your machine.

### Installation

1. Navigate to the frontend directory:
```Bash
   cd frontend/health-chain
```
2. Install dependencies:
```Bash
npm install
```
3. Create a local environment file from the example:
```Bash
   cp .env.example .env.local
```
4. Run the development server:
```Bash
npm run dev
```
5. Open http://localhost:3000 to view the Landing Page.
6. Navigate to http://localhost:3000/dashboard to view the Admin Interface.

### Environment

The frontend supports the following environment variables:

- `NEXT_PUBLIC_API_URL` — backend API base URL (default: `http://localhost:3001`)
- `NEXT_PUBLIC_API_PREFIX` — backend API prefix (default: `api/v1`)
- `NEXT_PUBLIC_WS_URL` — WebSocket server URL (default: `ws://localhost:3001`)

Next.js loads local overrides from `.env.local`. Make sure the backend is running at the configured API and WebSocket URLs before using the frontend.