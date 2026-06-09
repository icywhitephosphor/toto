/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle so the Docker runtime stage stays minimal.
  output: "standalone",
  reactStrictMode: true,
};

export default nextConfig;
