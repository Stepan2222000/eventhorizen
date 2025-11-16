import { promises as fs } from 'fs';
import { join } from 'path';
import type { DbConnection, SafeDbConnection, InsertDbConnection, ConnectionRole } from '@shared/schema';

const CONNECTIONS_FILE = join(process.cwd(), 'db-connections.json');

// Helper to strip password from connection object
function toSafeConnection(conn: DbConnection): SafeDbConnection {
  const { password, ...safe } = conn;
  return safe as SafeDbConnection;
}

// Read connections from JSON file
async function readConnections(): Promise<DbConnection[]> {
  try {
    const data = await fs.readFile(CONNECTIONS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error: any) {
    // If file doesn't exist, return empty array
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

// Write connections to JSON file
async function writeConnections(connections: DbConnection[]): Promise<void> {
  await fs.writeFile(CONNECTIONS_FILE, JSON.stringify(connections, null, 2), 'utf-8');
}

// Get all connections (without passwords)
export async function getConnections(): Promise<SafeDbConnection[]> {
  const connections = await readConnections();
  return connections.map(toSafeConnection);
}

// Get connection by ID (with password)
export async function getConnectionById(id: number): Promise<DbConnection | null> {
  const connections = await readConnections();
  return connections.find(c => c.id === id) || null;
}

// Get active connection by role
export async function getActiveConnectionByRole(role: ConnectionRole): Promise<SafeDbConnection | null> {
  const connections = await readConnections();
  const active = connections.find(c => c.role === role && c.isActive);
  return active ? toSafeConnection(active) : null;
}

// Create new connection
export async function createConnection(data: InsertDbConnection & { isActive?: boolean }): Promise<SafeDbConnection> {
  const connections = await readConnections();

  // Generate new ID
  const maxId = connections.length > 0 ? Math.max(...connections.map(c => c.id)) : 0;
  const newId = maxId + 1;

  // Create new connection object
  const now = new Date();
  const newConnection: DbConnection = {
    id: newId,
    name: data.name,
    host: data.host,
    port: data.port || 5432,
    database: data.database,
    username: data.username,
    password: data.password,
    ssl: data.ssl || null,
    role: data.role || null,
    tableName: data.tableName || null,
    fieldMapping: data.fieldMapping || null,
    isActive: data.isActive !== undefined ? data.isActive : false,
    createdAt: now,
    updatedAt: now,
  };

  connections.push(newConnection);
  await writeConnections(connections);

  return toSafeConnection(newConnection);
}

// Update connection
export async function updateConnection(id: number, data: Partial<InsertDbConnection> & { isActive?: boolean }): Promise<SafeDbConnection | null> {
  const connections = await readConnections();
  const index = connections.findIndex(c => c.id === id);

  if (index === -1) {
    return null;
  }

  // Update connection
  connections[index] = {
    ...connections[index],
    ...data,
    updatedAt: new Date(),
  };

  await writeConnections(connections);

  return toSafeConnection(connections[index]);
}

// Deactivate all connections with specified role except given ID
export async function deactivateConnectionsByRole(role: ConnectionRole, exceptId?: number): Promise<void> {
  const connections = await readConnections();
  const updated = connections.map(c => {
    if (c.role === role && c.id !== exceptId) {
      return { ...c, isActive: false, updatedAt: new Date() };
    }
    return c;
  });
  await writeConnections(updated);
}

// Delete connection
export async function deleteConnection(id: number): Promise<boolean> {
  const connections = await readConnections();
  const filtered = connections.filter(c => c.id !== id);

  if (filtered.length === connections.length) {
    return false; // Connection not found
  }

  await writeConnections(filtered);
  return true;
}

// Initialize with default connections
export async function initializeDefaultConnections(): Promise<void> {
  const existing = await readConnections();

  // Check if default connections already exist
  if (existing.some(c => c.name.startsWith('По умолчанию'))) {
    console.log('Default connections already exist, skipping...');
    return;
  }

  // External database credentials (parts_info)
  const externalHost = '81.30.105.134';
  const externalPort = 5404;
  const externalDatabase = 'parts_info';
  const externalUsername = 'admin';
  const externalPassword = 'Password123';

  const now = new Date();

  // Create SMART connection
  const smartConnection: DbConnection = {
    id: 1,
    name: 'По умолчанию (SMART)',
    host: externalHost,
    port: externalPort,
    database: externalDatabase,
    username: externalUsername,
    password: externalPassword,
    ssl: null,
    role: 'smart',
    tableName: 'public.smart',
    fieldMapping: {
      smart: 'smart',
      articles: 'артикул',
      name: 'наименование',
      brand: 'бренд',
      description: 'коннект_бренд',
    },
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  // Create Inventory connection
  const inventoryConnection: DbConnection = {
    id: 2,
    name: 'По умолчанию (Учёт)',
    host: externalHost,
    port: externalPort,
    database: externalDatabase,
    username: externalUsername,
    password: externalPassword,
    ssl: null,
    role: 'inventory',
    tableName: 'inventory.movements',
    fieldMapping: {
      id: 'id',
      smart: 'smart',
      article: 'article',
      qtyDelta: 'qty_delta',
      reason: 'reason',
      note: 'note',
      createdAt: 'created_at',
    },
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  await writeConnections([smartConnection, inventoryConnection]);
  console.log('Default connections created successfully');
}
