import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();
const basePath = process.env.BASE_PATH || "";

/** @type {import('next').NextConfig} */
const config = {
	output: "export",
	trailingSlash: true,
	basePath,
	env: {
		NEXT_PUBLIC_BASE_PATH: basePath,
	},
	reactStrictMode: true,
	agentRules: false,
	images: {
		unoptimized: true,
	},
	transpilePackages: ["@hyecompany/vem-data", "@hyecompany/vem-ui"],
	experimental: {
		extensionAlias: {
			".js": [".ts", ".tsx", ".js", ".jsx"],
		},
	},
};

export default withMDX(config);
