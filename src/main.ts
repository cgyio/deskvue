import * as Vue from 'vue'
import * as Deskvue from './Deskvue'

globalThis.Vue = Vue
globalThis.Deskvue = Deskvue

await Deskvue.start('#app')
