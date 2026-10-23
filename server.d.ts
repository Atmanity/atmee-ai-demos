// Types for server.js (plain JavaScript, no build step), for the site's server that mounts it.
import type { Express, RequestHandler } from 'express';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

/** The five apps' pages and /api routes. */
export declare const app: Express;
/** The DEMO_PASSWORD gate (HTTP basic auth, then a cookie); passes everything when no password is set. */
export declare const requirePassword: RequestHandler;
/** Takes a WebSocket upgrade for the five apps (the livestream chat). */
export declare function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
