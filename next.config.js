/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'ALLOWALL', // Allow iframe embedding
          },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' http://localhost:3000 https://*.vercel.app https://*.onrender.com *", // Allow embedding from your domains
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;

