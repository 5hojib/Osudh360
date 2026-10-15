import net from "node:net";
import pg from "pg";

/**
 * Postgres client helper for the local import/migration scripts.
 *
 * Neon endpoints publish both IPv6 and IPv4 addresses, and `dns.lookup` returns
 * the IPv6 ones first. On a host without IPv6 routing those addresses silently
 * blackhole, so the connection hangs and surfaces as ETIMEDOUT - even though
 * the very same endpoint answers over IPv4 in ~280 ms. Pinning the socket to
 * IPv4 avoids that.
 *
 * This is a *local tooling* concern only. The deployed Neon Function connects
 * from inside Neon's own network and uses a plain client.
 */

/**
 * pg calls `stream.connect(port, host)` with no options, so `family` cannot be
 * threaded through its config. Wrapping the socket is the supported hook.
 */
function ipv4Socket() {
  const socket = new net.Socket();
  const connect = socket.connect.bind(socket);
  socket.connect = ((...args: unknown[]) => {
    if (typeof args[0] === "number") {
      return connect({ port: args[0] as number, host: args[1] as string, family: 4 });
    }
    return (connect as (...a: unknown[]) => net.Socket)(...args);
  }) as typeof socket.connect;
  return socket;
}

export function createPgClient(url: string) {
  return new pg.Client({
    connectionString: url,
    // Neon presents a valid cert, but the hostname check is redundant here
    // because the connection is pinned to a single endpoint.
    ssl: { rejectUnauthorized: false },
    stream: ipv4Socket,
  });
}

/** Migrations and dumps must use the direct endpoint, never the pooled one. */
export function migrationUrl() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED / DATABASE_URL is not set");
  return url;
}

export function appUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}