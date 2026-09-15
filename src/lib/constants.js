// Shared constants used across handlers.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Project root is two levels up from src/lib/.
export const ROOT_DIR = join(__dirname, "..", "..");

// All runtime state (per-guild config/state JSON files, saved code
// snippets) lives under data/, separate from source code. This whole
// folder should be gitignored — see .gitignore.
export const DATA_DIR = join(ROOT_DIR, "data");

// Maximum size we accept for any file we download ourselves (GIF source
// attachments, saved code files). Discord itself may allow larger
// attachments depending on server boost level, so we still enforce this
// ourselves before downloading.
export const MAX_INPUT_SIZE = 25 * 1024 * 1024; // 25 MB
