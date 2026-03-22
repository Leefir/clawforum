/**
 * JSONL file operations
 * 
 * - appendJsonl: Append JSON record as a line (newline-delimited)
 * - readJsonl: Read and parse JSONL file, skip invalid lines
 * 
 * Note: Appends are safe for concurrent writes (OS-level atomicity for small writes)
 */

import { promises as fs } from 'fs';
import { appendFile } from '../fs/atomic.js';

/**
 * Append a JSON record to a JSONL file
 * @param filePath - Path to JSONL file
 * @param record - Record to append
 */
export async function appendJsonl(
  filePath: string,
  record: Record<string, unknown>
): Promise<void> {
  const line = JSON.stringify(record) + '\n';
  await appendFile(filePath, line);
}

/**
 * Read all records from a JSONL file
 * @param filePath - Path to JSONL file
 * @returns Array of parsed records (skips empty lines and invalid JSON)
 */
export async function readJsonl<T = Record<string, unknown>>(
  filePath: string
): Promise<T[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const records: T[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue; // Skip empty lines
      }
      
      try {
        const record = JSON.parse(trimmed) as T;
        records.push(record);
      } catch {
        console.warn(`[monitor] Skipping invalid JSONL line: ${trimmed.slice(0, 80)}`);
        continue;
      }
    }
    
    return records;
  } catch (error) {
    // File doesn't exist - return empty array
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Stream read JSONL file (for large files)
 * @param filePath - Path to JSONL file
 * @yields Parsed records
 */
export async function* streamJsonl<T = Record<string, unknown>>(
  filePath: string
): AsyncGenerator<T, void, unknown> {
  let file: fs.FileHandle;
  try {
    file = await fs.open(filePath, 'r');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw err;
  }
  
  try {
    const bufferSize = 64 * 1024; // 64KB chunks
    let buffer = '';
    
    while (true) {
      const chunk = Buffer.alloc(bufferSize);
      const { bytesRead } = await file.read(chunk, 0, bufferSize, null);
      
      if (bytesRead === 0) {
        break;
      }
      
      buffer += chunk.toString('utf-8', 0, bytesRead);
      
      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        try {
          yield JSON.parse(trimmed) as T;
        } catch {
          // Skip invalid lines
        }
      }
    }
    
    // Process final line
    const trimmed = buffer.trim();
    if (trimmed) {
      try {
        yield JSON.parse(trimmed) as T;
      } catch {
        // Skip invalid final line
      }
    }
  } finally {
    await file.close();
  }
}
