/** @type {import('next').NextConfig} */
const nextConfig = {
  // the workspace packages ship TypeScript sources; Next compiles them with the app
  transpilePackages: ['@corner/auth', '@corner/catalog', '@corner/db', '@corner/events', '@corner/orders', '@corner/payments'],
  serverExternalPackages: ['@prisma/client', 'nats'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'images.example.com' }],
  },
  experimental: {
    serverActions: { bodySizeLimit: '1mb' },
  },
};

export default nextConfig;
