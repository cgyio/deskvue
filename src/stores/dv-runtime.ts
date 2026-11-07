/**
 * Deskvue 运行时数据 store
 */

import {
    type App,
    ref,
    reactive,
    readonly,
    computed,
    toRef,
    watch,
    type ComponentPublicInstance,
    type Component,
    type DefineComponent,
} from 'vue'
import { defineStore } from 'pinia'
import { useWindowSize } from '@vueuse/core'
import { useDvAccountStore, type DvUacValidator, type DvUacRules } from './dv-account'
import type { DvWindowInstance } from '@components/types'
import { dvIs, dvWait } from '@utils/core'

//类型定义
export type PlainObject = Record<string, any>

//stage 可选序列
const dvStages = [
    'initing', //DvOs 组件还开始未渲染
    'starting', //DvOs 开始渲染，显示 Deskvue logo，启动进度条，progress = 10
    'service-loading', //DvOs 渲染完成，开始加载服务组件，progress = 20
    'service-ready', //服务组件加载完成，加载 DvLogin 组件开始登录流程，progress = 50
    'login-start', //DvLogin 组件渲染完成，检查 token 尝试登录
    'login-error', //多次尝试登录失败，终止后续，显示登录错误
    'login-ok', //登录成功，开始同步账号数据，progress = 70
    'account-ready', //账号数据同步成功，开始 setup 业务库，progress = 80
    'business-ready', //业务库 setup 完成，隐藏 DvLogin 组件，progress = 100 隐藏进度条，开始加载 DvDesktop 组件
    'desktop-prepare', //DvDesktop 组件渲染中，加载 桌面网格、图标、小组件、任务栏、已持久化的窗口
    'ready', //DvDesktop 组件渲染完成，Deskvue 启动序列完成
    'stage-error', //启动过程中，任意阶段发生错误，进入此 stage 将终止后续，显示启动失败
] as const
export type DvStage = (typeof dvStages)[number]
//stage 提示语
const dvStageTitles = {
    initing: '正在初始化',
    starting: '正在启动',
    'service-loading': '加载服务组件',
    'service-ready': '服务组件加载完成',
    'login-start': '正在登录',
    'login-error': '登录失败，无法进入系统',
    'login-ok': '登录成功，正在同步数据',
    'account-ready': '数据同步成功，准备应用列表',
    'business-ready': '应用列表已创建',
    'desktop-prepare': '准备桌面',
    ready: '启动完成',
    'stage-error': '启动失败，无法进入系统',
}

//定义 可用应用的 参数类型
export interface DvAppDefine {
    component: string
    title?: string
    desc?: string
    icon?: string
    iconProps?: Record<string, any>
    uac?: DvUacValidator | DvUacRules
    sys?: boolean
    [K: string]: any
}

//任务栏位置
const taskbarPositions = ['top', 'bottom'] as const
export type TaskbarPosition = (typeof taskbarPositions)[number]

//尺寸级别
const sizeTypes = ['small', 'medium', 'large'] as const
export type SizeType = (typeof sizeTypes)[number]

//桌面放置元素 1x1 尺寸范围
const desktopGridMinSize: Record<string, [number, number, number]> = {
    //small: [48, 60, 32], //[外框宽，外框高，图标宽高]
    //medium: [64, 80, 48],
    //large: [80, 100, 64],

    small: [64, 80, 48],
    medium: [80, 100, 64],
    large: [96, 120, 80],
}

//窗口布局紧凑程度
const windowTightnesses = ['compact', 'loose'] as const
export type WindowTightness = (typeof windowTightnesses)[number]

//可选的 ui 参数  select-options
const desktopGridSizeOpts = [
    { label: '较小：64×80 px', value: 'small' },
    { label: '中等：80×100 px', value: 'medium' },
    { label: '较大：96×120 px', value: 'large' },
]
const desktopGridGutterOpts = [
    { label: '较小：8 px', value: 8 },
    { label: '中等：16 px', value: 16 },
    { label: '较大：24 px', value: 24 },
]
const taskbarPositionOpts = [
    { label: '顶部', value: 'top' },
    { label: '底部', value: 'bottom' },
]
const taskbarSizeOpts = [
    { label: '较小：48 px', value: 48 },
    { label: '中等：64 px', value: 64 },
    { label: '较大：72 px', value: 72 },
]
const windowTightnessOpts = [
    { label: '紧凑排布', value: 'compact' },
    { label: '宽松排布', value: 'loose' },
]
const windowTightnessParams = {
    compact: {
        windowHeaderHeight: 48,
        windowFooterHeight: 72,
        windowPadding: 16,
        windowRadius: 24,
    },
    loose: {
        windowHeaderHeight: 64,
        windowFooterHeight: 96,
        windowPadding: 32,
        windowRadius: 32,
    },
}

//默认值
const defaultUiConfig = {
    dvLogo: 'https://ms.systech.work/src/icon/deskvue-logo${expand}${dark}.svg',
    wallpaper: 'https://qypms.systech.work/wallpaper/dvwp_${dark}.webp',
    //defaultWallpapers: '',
    desktopGridSize: 'medium',
    desktopGridGutter: 16,
    desktopPadding: 16,
    taskbarPosition: 'bottom',
    taskbarSize: 64,
    windowTightness: 'compact',
}

//可外部配置的（通过 install options 或 update 更新数据 配置的）数据
type DvRuntimeUiSpfIcon = {
    base: string
    jsFile: string
    sets: string[]
}
type DvRuntimeUiConfig = {
    spfIcon?: DvRuntimeUiSpfIcon
    dvLogo?: string
    wallpaper?: string
    defaultWallpapers?: string[]
    desktopGridSize?: SizeType
    desktopGridGutter?: number
    desktopPadding?: number
    taskbarPosition?: TaskbarPosition
    taskbarSize?: number
    windowPadding?: number
    windowHeaderHeight?: number
    windowFooterHeight?: number
    windowRadius?: number
    [K: string]: any
}
export interface DvRemoteRuntimeConfig {
    ui?: DvRuntimeUiConfig
    [K: string]: any
}

export const useDvRuntimeStore = defineStore(
    'dvRuntime',
    () => {
        //console.log('define dvRuntime start')

        //已初始化标记
        const inited = ref<boolean>(false)

        /**
         * stage 系统启动阶段相关
         */
        //stage
        const stage = ref<DvStage>('initing')
        //stage idx
        const stageIdx = computed<number>((): number => dvStages.indexOf(stage.value))
        //当前 stage 提示语
        const stageTitle = computed<string>((): string => dvStageTitles[stage.value])
        //启动序列 进入 *-error 阶段
        const stageIsError = computed<boolean>((): boolean => stage.value.endsWith('-error'))
        //!! 如果 stage = ready | *-error 将不再允许修改
        const stageLocked = computed<boolean>(
            (): boolean => stage.value === 'ready' || stageIsError.value === true,
        )
        //当 stage 跳转到 stage-error 时，显示的错误 icon
        const stageErrorIcon = ref<string>('md-round-report-gmailerrorred')
        //当 stage 跳转到 stage-error 时，显示的错误信息
        const stageErrorMsg = ref<string>('')
        //设置 stage
        const stageTo = (tstage: DvStage): void => {
            //在这种情况下，禁止修改 stage
            if (
                stageLocked.value === true && //stage = ready | *-error 且
                (tstage as string).endsWith('-error') !== true //要设置的状态 不是 *-error
            ) {
                return
            }
            //login-error 需要设置 msg/icon
            if (tstage === 'login-error') {
                stageErrorIcon.value = 'md-round-sentiment-very-dissatisfied'
                stageErrorMsg.value = '登录失败，无法进入系统'
            }
            //在任意 stage 状态下，都可以跳转为 *-error 状态
            stage.value = tstage
        }
        //任意阶段 跳转到 stage-error
        const stageToError = (msg: string): void => {
            if (msg.includes('::')) {
                const msga: string[] = msg.split('::')
                if (msga[0]) stageErrorIcon.value = msga[0]
                if (msga[1]) stageErrorMsg.value = msga[1]
            } else {
                stageErrorIcon.value = 'md-round-report-gmailerrorred'
                stageErrorMsg.value = msg
            }
            stageTo('stage-error')
        }
        //stage 向后跳转
        const stageNext = (): void => {
            if (stageIdx.value < 0) return
            const tidx = stageIdx.value + 1
            if (tidx >= dvStages.length || !dvStages[tidx]) return
            stageTo(dvStages[tidx])
        }
        //stage 判断
        const stageIs = (...stages: DvStage[]): boolean => stages.includes(stage.value)
        const stageAfter = (cstage: DvStage): boolean => {
            const idx = dvStages.indexOf(cstage)
            if (idx < 0) return false
            return stageIdx.value > idx
        }
        const stageBefore = (cstage: DvStage): boolean =>
            cstage !== stage.value && !stageAfter(cstage)
        //!! 带边界判断 stage ，一律包含边界
        const stageBetween = (stageA: DvStage, stageB: DvStage): boolean => {
            if ([stageA, stageB].includes(stage.value)) return true
            const idxa = dvStages.indexOf(stageA)
            const idxb = dvStages.indexOf(stageB)
            if (idxa < 0 || idxb < 0 || idxa === idxb) return false
            const idxs: [number, number] = idxb > idxa ? [idxa, idxb] : [idxb, idxa]
            return stageIdx.value > idxs[0] && stageIdx.value < idxs[1]
        }
        const stageOutside = (stageA: DvStage, stageB: DvStage): boolean => {
            if ([stageA, stageB].includes(stage.value)) return true
            return !stageBetween(stageA, stageB)
        }

        /**
         * service 全局服务组件相关
         */
        //服务组件列表 — 从 dvServices 自动初始化，无需手动同步
        const service = reactive<Record<string, boolean>>(
            Object.fromEntries(
                Object.keys(globalThis.Deskvue?.dvServices ?? {}).map((k) => [k, false]),
            ),
        )
        //服务组件名称列表
        const serviceNames = computed<string[]>((): string[] => {
            return Object.keys(service)
        })
        //业务库可以在 stageBefore('business-ready') 时将 业务服务组件写入 service 列表（通常在 业务库 setup 方法中）
        const setBusinessService = (serviceName: string): void => {
            if (stageBefore('business-ready')) {
                service[serviceName] = false
            }
        }
        //服务组件实例列表
        const serviceInstance = reactive<Record<string, ComponentPublicInstance>>({})
        //某个核心组件启动完成后，设置 ready 状态，以及调整进度
        const serviceReady = (serviceName: string): void => {
            const services = Object.keys(service)
            if (!services.includes(serviceName) || service[serviceName] === true) return

            //设置 ready 状态
            service[serviceName] = true

            //如果 stage 还可以修改，则调整 progress
            if (stageLocked.value) return

            const clen = services.length
            const to = 50 //所有核心组件启动完成后，进度条滚到到 50
            let cidx = -1
            services.forEach((ci) => {
                if (service[ci] === true) {
                    cidx += 1
                }
            })
            //调整 进度条
            updateStartProgressInQueue(to, clen, cidx)
        }
        //核心组件是否已经启动完成
        const serviceAllReady = computed<boolean>((): boolean => {
            const services = Object.keys(service)
            for (const ci of services) {
                if (service[ci] === false) return false
            }
            return true
        })
        //监听
        watch(serviceAllReady, (nv, ov) => {
            if (nv === true) {
                //全部 service 加载完成，stage -> service-ready
                stageTo('service-ready')
                setStartProgress(50)
            }
        })

        //所有已开启的 DvWindow 窗口组件实例
        const windows = reactive<Record<string, DvWindowInstance>>({})
        //新建窗口时，添加窗口实例到 windows
        const windowOpen = (winId: string, winIns: DvWindowInstance): boolean => {
            if (winId !== '' && !windows?.[winId]) {
                windows[winId] = winIns
                return true
            }
            return false
        }
        //从 windows 中删除窗口实例
        const windowClose = (winId: string): boolean => {
            if (windows?.[winId]) {
                Reflect.deleteProperty(windows, winId)
                return true
            }
            return false
        }

        //业务组件库 setup 方法列表 — 由 injectDvBusinessLibs 收集，login 后执行
        const libSetups = reactive<Array<(app: App) => Promise<void>>>([])

        /**
         * 本次会话中所有可用的 应用组件(compDefine.isDvApp = true 且有 windowMeta 参数的全局组件)
         * 用户登录后，会对此列表按 用户角色|权限 进行修剪
         * 业务组件库需要在 setup 方法中将自定义的 应用列表写到这里
         */
        const apps = reactive<Record<string, DvAppDefine>>({})
        //定义需要排除的 app 应用组件，排除的应用组件，不会显示在 launcher 开始菜单中
        const exceptApps = ref<string[]>([])
        //当前登录用户的 可用 apps 应用组件(componentDefine.isDvApp === true)
        const availableApps = computed<Record<string, DvAppDefine> | undefined>(() => {
            if (isLogin.value !== true) return undefined
            if (!apps || !dvIs.nemobj(apps)) return undefined
            const avapps: Record<string, DvAppDefine> = {}

            const dvAccount = useDvAccountStore()
            //!! 应用组件的权限需要检查 dvUpdate.feature
            const feature = globalThis.DvApp.config.globalProperties.$dvUpdate?.feature
            for (const appn in apps) {
                //检查此 app 是否被排除
                if (exceptApps.value.includes(appn)) continue
                const app = apps?.[appn]

                //!! 对当前登录用户执行 权鉴
                //!! 优先检查 dvUpdateStore.feature
                //!! 然后检查 app 应用组件定义的 windowUac 参数
                const uac = feature?.[appn] ?? app?.uac ?? undefined
                //直接禁止某个应用组件
                if (uac === false) continue
                //如果 此应用组件没有定义权限控制参数 或 用户拥有相应权限
                if (uac === undefined || dvAccount.uacValidate(uac) === true) {
                    avapps[appn] = app as DvAppDefine
                }
            }
            if (!dvIs.nemobj(avapps)) return undefined
            return avapps
        })
        //向 应用列表 写入应用定义
        const setApp = (componentName: string, component: Component | DefineComponent): boolean => {
            const def = component as Record<string, any>
            if (def?.isDvApp !== true) return false
            const meta = def?.windowMeta
            const uacs = def?.windowUac
            if (!meta || !dvIs.nemobj(meta)) return false

            //应用写入 apps 列表
            apps[componentName] = {
                component: componentName,
                title: meta?.title,
                desc: meta?.desc,
                icon: meta?.icon,
                iconProps: meta?.iconProps,
                uac: uacs,
                sys: def?.isSysApp === true,
            } as DvAppDefine

            return true
        }
        //向 排除列表写入 app
        const setExceptApps = (...appns: string[]): void => {
            exceptApps.value.push(...appns)
            const set = new Set(exceptApps.value)
            exceptApps.value = [...set]
        }
        //根据 应用组件名 获取 应用定义
        const getAppDefine = (componentName: string): DvAppDefine | undefined => {
            //如果用户未登录，无法获取应用定义
            if (isLogin.value !== true) return undefined
            return availableApps.value?.[componentName]
        }

        //login 阶段
        //用户已成功登录 标记
        const _isLogin = ref<boolean>(false)
        //外部检查
        const isLogin = readonly(_isLogin)
        //设置已登录 状态
        const setLogin = (login: boolean = true): void => {
            _isLogin.value = login
        }

        //在账号登录成功后，runtime 初始化
        const initAfterLoginOk = async (): Promise<void> => {
            //必须在账号成功登录后执行
            if (isLogin.value !== true) return

            //从 账号 config 中读取 个性化参数
            await syncConfig('from')

            //如果 occupation 桌面网格占用还未处理过
            if (occupyInited.value !== true) {
                //初始化 持久化快捷方式中，还未生成 occupy 参数的项目
                //await shortcutOccupy()
                await globalThis.Deskvue?.useDvUi?.()?.desktopGridOccupy?.()
            }
        }
        //登录后从 账号 config 中读取 个性化参数 或 将 runtime 中的参数写入账号持久化数据中
        const syncConfig = async (type: 'from' | 'to' = 'from'): Promise<void> => {
            //必须在账号成功登录后执行
            if (isLogin.value !== true) return

            //读取账号个性化配置
            const dvAccount = useDvAccountStore()
            const config = dvAccount.config

            //定义可以被用户个性化配置的 参数项目
            const configs: Record<string, any> = {
                dvLogo,
                wallpaper,
                defaultWallpapers,
                desktopGridSize,
                desktopGridGutter,
                desktopPadding,
                taskbarPosition,
                taskbarSize,
                windowTightness,
                windowPadding,
                windowHeaderHeight,
                windowFooterHeight,
                windowRadius,
            }
            const keys: string[] = Object.keys(configs)
            for (const key of keys) {
                if (type === 'from') {
                    //从持久化数据中 获取 config
                    if (config?.[key] === undefined) {
                        //没有个性化配置，则写入
                        config[key] = configs[key].value
                    } else if (config[key] !== configs[key].value) {
                        //存在个性化配置，则从个性化配置中获取
                        configs[key].value = config[key]
                    }
                } else if (type === 'to') {
                    //将 runtime 中的参数 写入 持久化数据中
                    config[key] = configs[key].value
                }
            }
            await dvWait(100)
        }
        //将 uiConfig 恢复为默认值，如果用户已登录，同时将持久化的用户设置也恢复为默认值
        const restoreConfig = async (): Promise<void> => {
            //先恢复默认值
            const dftc = defaultUiConfig
            dvLogo.value = dftc.dvLogo
            wallpaper.value = dftc.wallpaper
            //defaultWallpapers.value = ''
            desktopGridSize.value = dftc.desktopGridSize as SizeType
            desktopGridGutter.value = dftc.desktopGridGutter
            desktopPadding.value = dftc.desktopPadding
            taskbarPosition.value = dftc.taskbarPosition as TaskbarPosition
            taskbarSize.value = dftc.taskbarSize
            windowTightness.value = dftc.windowTightness as WindowTightness

            await dvWait(100)

            //必须在账号成功登录后执行
            if (isLogin.value === true) {
                await syncConfig('to')
            }
        }

        /**
         * ui 相关
         */
        //SpfIcon 图标库，使用标准的 SPF-Icon 图标库
        const spfIcon = ref<DvRuntimeUiSpfIcon>({
            //图标库 url 前缀
            base: 'https://ms.systech.work/src/icon/',
            //雪碧图 js 文件名
            jsFile: '/default.js',
            //要使用的图标库名称
            sets: ['deskvue', 'md-round', 'spinner', 'vsc'],
        })
        //Deskvue 当前的 logo，不同的应用可使用不同的 logo
        const dvLogo = ref<string>(defaultUiConfig.dvLogo)
        //wallpaper
        const wallpaper = ref<string>(defaultUiConfig.wallpaper)
        //Deskvue 系统默认的 可用壁纸列表
        const defaultWallpapers = ref<string[]>([
            'https://qypms.systech.work/wallpaper/dvwp_${dark}.webp',
            'https://qypms.systech.work/wallpaper/dvwp_win11_main_${dark}.webp',
            'https://qypms.systech.work/wallpaper/dvwp_win11_22h2_${dark}.webp',
        ])

        //启动阶段进度条进度值
        const startProgress = ref<number>(0)
        const setStartProgress = (to: number): void => {
            const n = to < 0 ? 0 : to > 100 ? 100 : to
            startProgress.value = n
        }
        //进度增加
        const updateStartProgress = (n: number): void => {
            const np = startProgress.value + n
            startProgress.value = np > 100 ? 100 : np < 0 ? 0 : np
        }
        //进度递增
        const updateStartProgressInQueue = (
            to: number, //进度增加到
            length: number, //一共要增加几次
            cidx: number = 0, //当前已经增加到第几次，从 0 开始
        ): void => {
            const op = startProgress.value
            const len = length - cidx - 1
            if (len <= 0) return
            //每次增加值
            const dv = (to - op) / len
            return updateStartProgress(dv)
        }

        //桌面网格的尺寸级别
        const desktopGridSize = ref<SizeType>(defaultUiConfig.desktopGridSize as SizeType)
        //桌面网格的间距
        const desktopGridGutter = ref<number>(defaultUiConfig.desktopGridGutter)
        //获取视口尺寸，自动监听并响应式变化
        const { width: vw, height: vh } = useWindowSize()
        //桌面的边距
        const desktopPadding = ref<number>(defaultUiConfig.desktopPadding)
        //桌面任务栏 位置
        const taskbarPosition = ref<TaskbarPosition>(
            defaultUiConfig.taskbarPosition as TaskbarPosition,
        )
        //桌面任务栏 尺寸
        const taskbarSize = ref<number>(defaultUiConfig.taskbarSize)
        //根据视口尺寸，自动计算 dv-desktop 桌面的网格尺寸
        const desktopGrid = computed<PlainObject | null>((): PlainObject | null => {
            //桌面边距
            const padding = desktopPadding.value
            //任务栏尺寸
            const tsz = taskbarSize.value
            //桌面实际可用尺寸
            const rw = vw.value - 2 * padding,
                rh = vh.value - tsz - 2 * padding
            //网格尺寸
            const defSize = desktopGridMinSize[desktopGridSize.value]
            if (!defSize) return null
            //网格间距
            const gutter = desktopGridGutter.value
            //x,y 方向的格子数量
            const xlen = Math.floor(rw / (defSize[0] + gutter))
            const ylen = Math.floor(rh / (defSize[1] + gutter))
            //!! 如果视口过小，xlen|ylen == 0
            if (xlen <= 0 || ylen <= 0) return null

            return {
                padding,
                length: { x: xlen, y: ylen },
                size: {
                    width: rw / xlen,
                    height: rh / ylen,
                    icon: defSize[2],
                    gutter,
                },
            }
        })
        //桌面网格被占用缓存 二维数组，每个元素代表一个桌面网格，0|1 表示 未占用|已占用
        const desktopGridOccupation = ref<number[][]>([])
        //重置 occupation 通常在网格参数发生变化后执行
        const resetDesktopGridOccupation = (): void => {
            const grid = desktopGrid.value
            if (!grid || !grid?.length?.x || !grid?.length?.y) {
                desktopGridOccupation.value = []
                return
            }
            const { x: xlen, y: ylen } = grid.length
            if (ylen <= 0 || xlen <= 0) {
                desktopGridOccupation.value = []
                return
            }

            //填充 y 行 x 列的 0
            const fill = (x: number, y: number, n: number = 0) =>
                Array.from({ length: y }, () => Array(x).fill(n))

            //填充
            desktopGridOccupation.value = fill(xlen, ylen)
        }
        //监听 desktopGrid，taskbarPosition 重新排布桌面网格，图标，widget
        watch(
            [desktopGrid, taskbarPosition],
            ([grid, position]): void => {
                //重置 occupation
                resetDesktopGridOccupation()

                //用户登录后
                if (isLogin.value === true) {
                    //重新排布 shortcut
                    globalThis.Deskvue?.useDvUi?.()?.desktopGridOccupy?.() //shortcutOccupy()
                }
            },
            { deep: true, immediate: true },
        )
        //初始化桌面网格占用，标记已经初始化
        const occupyInited = ref<boolean>(false)

        //窗口系统
        const windowTightness = ref<WindowTightness>(
            defaultUiConfig.windowTightness as WindowTightness,
        )
        const windowPadding = ref<number>(16)
        const windowHeaderHeight = ref<number>(48)
        const windowFooterHeight = ref<number>(72)
        const windowRadius = ref<number>(24)
        //窗口标题栏图标
        const windowHeaderBtnSize = computed<number>(
            (): number => windowHeaderHeight.value - windowPadding.value,
        )
        const windowHeaderIconSize = computed<number>((): number => windowHeaderBtnSize.value - 8)
        //设置 windowTightness
        const setWindowTightness = (tightness: string = 'compact'): void => {
            const tps = windowTightnessParams as Record<string, any>
            const tpi = tps?.[tightness]
            if (!tpi || !dvIs.nemobj(tpi)) return
            //写入设置
            if (tpi?.windowHeaderHeight) windowHeaderHeight.value = tpi.windowHeaderHeight
            if (tpi?.windowFooterHeight) windowFooterHeight.value = tpi.windowFooterHeight
            if (tpi?.windowPadding) windowPadding.value = tpi.windowPadding
            if (tpi?.windowRadius) windowRadius.value = tpi.windowRadius
        }
        //根据 windowTightness 批量设置 windowHeaderHeight|Padding|FooterHeight|Radius
        watch(windowTightness, () => {
            //根据 windowTightness 设置其他参数
            setWindowTightness(windowTightness.value)
            /*if (windowHeaderHeight.value === 48) {
                windowFooterHeight.value = 72
                windowPadding.value = 16
                windowRadius.value = 24
            } else if (windowHeaderHeight.value === 64) {
                windowFooterHeight.value = 96
                windowPadding.value = 32
                windowRadius.value = 32
            }*/
        })

        //工具方法

        //初始化 store
        const initStore = (app: App, options: PlainObject = {}): void => {
            //仅执行一次
            if (inited.value) return

            //首先 update
            const dvUpdate = globalThis.DvApp.config.globalProperties.$dvUpdate
            if (dvUpdate?.updateStore) dvUpdate.updateStore('runtime')

            //然后 install
            if (options?.runtime) updateStore(options.runtime)

            //标记 inited
            inited.value = true
        }

        //自动更新接口返回 对应数据后，写入 store
        const updateStore = (updata?: DvRemoteRuntimeConfig): void => {
            if (updata?.ui) updateUi(updata.ui)
        }
        //自动更新各项数据
        const updateUi = (ui?: DvRuntimeUiConfig): void => {
            if (ui?.['spfIcon']) {
                spfIcon.value = ui.spfIcon
                updateSpfIcon()
            }
            if (ui?.['dvLogo']) dvLogo.value = ui.dvLogo
            if (ui?.['wallpaper']) wallpaper.value = ui.wallpaper
            if (ui?.['defaultWallpapers']) {
                defaultWallpapers.value = ui.defaultWallpapers
            }
            if (ui?.['desktopGridSize']) desktopGridSize.value = ui.desktopGridSize
            if (ui?.['desktopGridGutter']) desktopGridGutter.value = ui.desktopGridGutter
            if (ui?.['desktopPadding']) desktopPadding.value = ui.desktopPadding
            if (ui?.['taskbarPosition']) taskbarPosition.value = ui.taskbarPosition
            if (ui?.['taskbarSize']) taskbarSize.value = ui.taskbarSize
            if (ui?.['windowPadding']) windowPadding.value = ui.windowPadding
            if (ui?.['windowHeaderHeight']) windowHeaderHeight.value = ui.windowHeaderHeight
            if (ui?.['windowFooterHeight']) windowFooterHeight.value = ui.windowFooterHeight
            if (ui?.['windowRadius']) windowRadius.value = ui.windowRadius
        }
        //自动生成 SpfIcon 图标库雪碧图
        const updateSpfIcon = (): void => {
            const si = spfIcon.value
            const spfIconSets = si.sets.map((icon: string): string => {
                if (icon.startsWith('http')) return `${icon}${si.jsFile}`
                return `${si.base}${icon}${si.jsFile}`
            })
            spfIconSets.forEach((src: string) => {
                // 创建 script 标签
                const script = document.createElement('script')
                //插入 雪碧图 js
                script.src = src
                script.type = 'text/javascript'
                script.async = true // 可选，不阻塞渲染
                // 插入 head
                document.head.appendChild(script)
            })
        }

        return {
            inited,

            stage,
            stageTitle,
            stageIsError,
            stageLocked,
            stageIdx,
            stageErrorIcon,
            stageErrorMsg,
            stageTo,
            stageToError,
            stageNext,
            stageIs,
            stageAfter,
            stageBefore,
            stageBetween,
            stageOutside,

            service,
            serviceNames,
            setBusinessService,
            serviceInstance,
            serviceReady,
            serviceAllReady,

            windows,
            windowOpen,
            windowClose,

            libSetups,

            availableApps,
            exceptApps,
            setApp,
            setExceptApps,
            getAppDefine,

            isLogin,
            setLogin,

            initAfterLoginOk,
            syncConfig,
            restoreConfig,

            startProgress,
            setStartProgress,
            updateStartProgress,
            updateStartProgressInQueue,

            spfIcon,
            dvLogo,
            wallpaper,
            defaultWallpapers,

            sizeTypes,
            desktopGridSizeOpts,
            desktopGridGutterOpts,
            taskbarPositionOpts,
            taskbarSizeOpts,
            windowTightnessOpts,
            setWindowTightness,

            vw,
            vh,
            desktopGridSize,
            desktopGridGutter,
            desktopPadding,
            taskbarSize,
            taskbarPosition,
            desktopGrid,
            desktopGridOccupation,
            occupyInited,
            windowTightness,
            windowPadding,
            windowHeaderHeight,
            windowFooterHeight,
            windowRadius,
            windowHeaderBtnSize,
            windowHeaderIconSize,

            initStore,
            updateStore,
        }
    },
    {
        persist: false,
    },
)

//!! 返回 store 类型
export type DvRuntimeStore = ReturnType<typeof useDvRuntimeStore>
