import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = packageJson.version
const releaseTag = `v${version}`
const setupName = `QuestPlanner_${version}_x64-setup.exe`
const sigPath = path.join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis', `${setupName}.sig`)
const outPath = path.join(root, 'src-tauri', 'target', 'release', 'bundle', 'latest.json')

if (!fs.existsSync(sigPath)) {
  throw new Error(`Signature introuvable: ${sigPath}`)
}

const latest = {
  version,
  notes: process.env.RELEASE_NOTES || 'Mise a jour QuestPlanner.',
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: fs.readFileSync(sigPath, 'utf8').trim(),
      url: `https://github.com/jdtaccounts-create/QuestPlanner/releases/download/${releaseTag}/${setupName}`,
    },
  },
}

fs.writeFileSync(outPath, `${JSON.stringify(latest, null, 2)}\n`)
console.log(outPath)
