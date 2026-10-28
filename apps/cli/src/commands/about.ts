import { Command } from 'commander'
import kleur from 'kleur'
import { platform, version as nodeVersion, cwd } from 'node:process'
import { VERSION, brandColorBold } from '../constants.js'

/**
 * Create the 'about' command
 * Displays information about Asterdoc CLI
 */
export function createAboutCommand(): Command {
  const about = new Command('about')

  about.description('Display information about Asterdoc CLI').action(() => {
    console.log()
    console.log(brandColorBold('Asterdoc CLI'))
    console.log()
    console.log(`${kleur.gray('Version:')}        ${kleur.white(VERSION)}`)
    console.log(`${kleur.gray('Platform:')}       ${kleur.white(platform)}`)
    console.log(`${kleur.gray('Node Version:')}   ${kleur.white(nodeVersion)}`)
    console.log(`${kleur.gray('Working Dir:')}    ${kleur.white(cwd())}`)
    console.log()
  })

  return about
}
