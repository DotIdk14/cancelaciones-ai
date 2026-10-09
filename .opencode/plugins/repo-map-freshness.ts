import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Plugin } from "@opencode/plugin"

const script = resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/brain/update-repo-map.ps1")

function checkFreshness(): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Mode", "Check"],
      { stdio: "ignore", windowsHide: true },
    )
    child.once("error", (error) => {
      console.error(`[repo-map] No se pudo comprobar la frescura: ${error.message}`)
      resolve()
    })
    child.once("exit", (code) => {
      if (code !== 0) console.error(`[repo-map] La comprobación terminó con código ${code}.`)
      resolve()
    })
  })
}

export default Plugin.define({
  id: "cancelaciones.repo-map-freshness",
  async setup(ctx) {
    await checkFreshness()
    await ctx.session.hook("prompt", async () => {
      await checkFreshness()
    })
  },
})
