/** @type {import('next').NextConfig} */
const nextConfig = {
  // Load at runtime from node_modules instead of bundling: pdf-parse resolves its
  // optional @napi-rs/canvas dependency (DOMMatrix polyfill) dynamically.
  serverExternalPackages: ['pdf-parse'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'secure.gravatar.com',
      },
      {
        // GitHub OAuth profile pictures (session.user.image)
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
    ],
  },
};

export default nextConfig;
