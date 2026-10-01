import Database from "better-sqlite3";
import path from "node:path";

const [sourcePath, destinationPath] = process.argv.slice(2);
if (!sourcePath || !destinationPath || path.resolve(sourcePath) === path.resolve(destinationPath)) {
  throw new Error("Indica rutas distintas para la base de datos de origen y destino.");
}

const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
try {
  await source.backup(destinationPath);
} finally {
  source.close();
}
