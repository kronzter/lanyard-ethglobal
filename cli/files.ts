// Durable local operator journals: flush bytes before an atomic rename and directory sync.
import { open, mkdir, rename } from "node:fs/promises";
import path from "node:path";
export async function durableWrite(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
  const directory = await open(path.dirname(file), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
export async function durableAppend(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const handle = await open(file, "a", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}
