const { echo } = require('shelljs')
const {
  run,
  writeSrc,
  builder,
  patchNsisKeepShortcuts
} = require('./build-common')

async function main () {
  const outputDirectory = 'dist/fiberterm-local'
  echo('building local Windows NSIS installer without upload or dist cleanup')

  patchNsisKeepShortcuts()
  writeSrc('win-x64-installer.exe')
  await run(`${builder} --win nsis --config build/electron-builder.json --config.directories.output=${outputDirectory}`)
}

main()
