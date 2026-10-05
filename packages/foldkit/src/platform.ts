import { onUnmountModule } from './onUnmountModule.js'
import { propsModule } from './propsModule.js'
import { type DOMAPI, htmlDomApi } from './snabbdom/htmldomapi.js'
import {
  type Module,
  attributesModule,
  classModule,
  datasetModule,
  eventListenersModule,
  styleModule,
} from './snabbdom/index.js'

/**
 * The host a runtime renders into. `domApi` performs every node operation the
 * virtual DOM needs, `modules` is the complete list of snabbdom modules that
 * apply attributes, props, styles, and listeners to those nodes, and
 * `requestFrame` schedules the render frame that patches batched Model
 * changes. Pass one to `makeElement` or `makeApplication` to render somewhere
 * other than the browser DOM. A custom `modules` list replaces the browser
 * one entirely, so it must include `onUnmountModule` for `OnUnmount` to fire.
 */
export type Platform = Readonly<{
  domApi: DOMAPI
  modules: ReadonlyArray<Partial<Module>>
  requestFrame: (callback: () => void) => void
}>

// NOTE: module order is load-bearing for hydration. `attributesModule` must run
// before `propsModule`. When a controlled input is adopted, the seeded server
// `value` attribute is removed by the attrs module first, which resets
// `elm.value`; only then does the props module reassert the model value, its
// `elm[key] !== cur` guard now seeing a cleared value. In the reverse order the
// props write is skipped as a no-op and the later attribute removal blanks the
// input. The controlled-input hydration tests fail if this order is changed.
/** The default Platform: the browser DOM, the stock module list, and
 *  `requestAnimationFrame`. */
export const browserPlatform: Platform = {
  domApi: htmlDomApi,
  modules: [
    attributesModule,
    classModule,
    datasetModule,
    eventListenersModule,
    onUnmountModule,
    propsModule,
    styleModule,
  ],
  requestFrame: callback => {
    requestAnimationFrame(callback)
  },
}
