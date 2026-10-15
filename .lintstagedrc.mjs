import path from "node:path"

// Vendored subtrees under repos/ are read-only and must never be reformatted.
const isVendored = (file) =>
  path.relative(import.meta.dirname, file).startsWith(`repos${path.sep}`)

export default {
  "*": (files) => {
    const own = files.filter((file) => !isVendored(file))
    return own.length > 0
      ? `prettier --ignore-unknown --write ${own.map((file) => JSON.stringify(file)).join(" ")}`
      : []
  },
}
