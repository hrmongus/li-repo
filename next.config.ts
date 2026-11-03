import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: '10mb' } }, // CSV uploads
};

export default nextConfig;
