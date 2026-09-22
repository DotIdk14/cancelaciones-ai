import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typedRoutes: true,
  transpilePackages: ['@cancelaciones/domain', '@cancelaciones/db', '@cancelaciones/policy-engine'],
};

export default nextConfig;
