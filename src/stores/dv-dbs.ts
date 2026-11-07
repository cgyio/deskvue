/**
 * Deskvue 后端数据库 结构化配置参数 store
 * 此 store 将被持久化，且不依赖登录账号做区分
 *
 * !! 完整适配 SPF-Orm 后端框架
 */

import { type App, ref, reactive, readonly, computed } from 'vue'
import { defineStore } from 'pinia'
import { useDvRuntimeStore } from './dv-runtime'
import { useDvAccountStore } from './dv-account'
import { type DvTableProps } from '@/components'
import {
    useDvRequest,
    type ValidRequestPath,
    type DvRequestInstance,
    type DvColumnTypeFull,
    type DvColumnJsType,
} from '@utils/composable'
import type { DvThisApiReturn } from '@/types/apis'
import { dvIs, dvExtend, dvCopy, dvWait, dvLoget, dvTrimAny } from '@utils/core'

//SPF-Orm 框架 标准数据表前端参数结构
//join 关联表参数结构
export interface DvTableJoinConfig {
    table: string
    alias?: string
    title?: string
    columns: string[]
    type: string
    dep?: string[]
    param?: Record<string, any>
}
//table 数据表组件 mode 显示模式的 参数结构
export interface DvTableMode {
    title: string //显示模式名称
    join?: string[] //此模式需要 join 关联表
    columns: string[] //包含字段名，已处理过，一定有数据
    isClassic: boolean //是否经典表格样式
    component?: string //如果不是经典表格样式，指定每条记录的渲染组件，全局组件
    props?: Record<string, any> //组件默认 props
}
//table 数据表组件 highlight 行高亮参数结构
export interface DvTableHighlight {
    columns: string[] //涉及到的 字段名
    function: string //判断函数体，一个入参 rs 代表当前记录实例，返回 boolean
    level: string //高亮样式类别，前端以此生成实际高亮样式
    style?: Record<string, any> //后端指定的 兜底样式 {}
}
//table 数据表组件 参数 类型
export interface DvTableFrontConfig {
    hide?: string[] //全局隐藏的 字段列表
    mode?: {
        //可选显示模式
        [K: string]: DvTableMode
    }
    highlight?: DvTableHighlight[] //高亮条件
    [K: string]: any
}
//form 表单 参数类型
export interface DvFormFrontConfig {
    hide?: string[]
    validator?: Record<string, string>
    [K: string]: any
}
//SPF-Orm 框架 标准数据表前端参数结构
export interface DvFrontConfig {
    table?: DvTableFrontConfig
    form?: DvFormFrontConfig
    [K: string]: any
}

//定义 后端返回的 数据库结构化配置参数
export interface DvColumnConfig {
    meta: {
        name: string
        title?: string
        desc?: string
        [K: string]: any
    }
    xpath: string
    type: DvColumnJsType
    types: DvColumnTypeFull

    isGetter: boolean
    isPk: boolean
    isId: boolean
    isRequired: boolean
    isIncludes: boolean
    isSort: boolean
    isSearch: boolean
    isFilter: boolean

    isSwitch?: boolean
    isJson?: boolean
    isSelect?: boolean
    isCascade?: boolean
    isDatetime?: boolean
    isTime?: boolean
    isNumber?: boolean
    isMoney?: boolean
    switch?: {
        true?: number | string
        false?: number | string
    }
    json?: {
        type?: 'associate' | 'indexed'
        default?: any
    }
    select?: {
        dynamic?: boolean
        multiple?: boolean
        'allow-create'?: boolean
        cascade?: boolean
        source: {
            db?: string
            table?: string
            label?: string
            value?: string
            where?: Record<string, any>
            api?: string
        }
    }
    datetime?: {
        type?: string
        default?: any
    }
    time?: {
        type?: string
        default?: any
    }
    number?: {
        precision?: number
        step?: number
    }
    money?: {
        precision?: number
        step?: number
        sign?: string
    }

    hideInTable: boolean
    hideInForm: boolean
    hasValidator: boolean
    validator?: string

    width: number
    inputer?: {
        component: string
        props: {
            [K: string]: any
        }
    }
}
export interface DvModelConfig {
    meta: {
        name: string
        title?: string
        desc?: string
        [K: string]: any
    }
    xpath: string
    columns: string[] //物理字段列表
    getters: string[] //计算字段列表
    allColumns: string[] //全部字段列表
    special: {
        //特殊字段
        [K: string]: string[]
    }
    join?: {
        tables?: string[]
        columns?: string[]
        param?: Record<string, DvTableJoinConfig>
        origin?: Record<string, any>
    }
    front?: DvFrontConfig //后端定义的 前端参数
    //后端返回的 数据表的 record 记录的 interface
    tsInterface: {
        [K: string]: string
    }
    column: {
        [K: string]: DvColumnConfig
    }
}
export interface DvDbConfig {
    meta: {
        name: string
        title?: string
        desc?: string
        [K: string]: any
    }
    frontend: string
    models: string[]
    model: {
        [K: string]: DvModelConfig
    }
    expireAt: number
}

//可用数据模型列表 单条记录结构
export interface DvAvailableModelItem {
    name: string
    title: string
    desc: string
    xpath: string
    tpath: string
    oprs: '*' | string[]
    columns: string[]
    [K: string]: any
}
//所有可用数据模型的 记录结构
export interface DvAvailableDbItem {
    name: string
    title: string
    desc: string
    models: Record<string, DvAvailableModelItem>
    [K: string]: any
}

//数据库全局可用的 下拉列表选项结构
export type DvDbSelectOption = {
    label: string
    value: string | number
    children?: DvDbSelectOption[]
    [K: string]: any
}
export interface DvDbSelectOptions {
    //一维枚举
    enum: {
        [K: string]: DvDbSelectOption[]
    }
    //多维 树形结构
    tree: {
        [K: string]: DvDbSelectOption[]
    }
    //缓存有效期
    expireAt: number
}
//默认的 数据库相关的 全局枚举
//!! 如果后端拉取到相同键名的数据，此处的将被覆盖
const defaultDbEnum = {
    //pagesize 分页
    pagesize: [
        { label: '每页 20 条', value: 20 },
        { label: '每页 50 条', value: 50 },
        { label: '每页 100 条', value: 100 },
        { label: '每页 200 条', value: 200 },
        { label: '每页 500 条', value: 500 },
        { label: '每页 1000 条', value: 1000 },
        { label: '不限条数', value: 9999 },
    ],
} as { [K: string]: DvDbSelectOption[] }
const defaultDbTree = {} as { [K: string]: DvDbSelectOption[] }

//数据模型 schema 参数
//数据表显示字段的 schema 结构
export interface DvColumnSchema {
    //字段基础参数
    //元数据
    meta: {
        name: string
        title?: string
        desc?: string
    }
    //xpath
    xpath: string
    //字段 js 类型
    type: DvColumnJsType
    //完整字段类型
    types: DvColumnTypeFull
    //特殊字段类型
    isId: boolean
    isGetter: boolean
    isSort: boolean
    isFilter: boolean
    isSearch: boolean

    //关联表
    //是否关联表字段
    isJoin: boolean
    //关联表参数
    join?: {
        //关联表元数据
        meta: {
            name: string
            title?: string
            desc?: string
        }
        //xpath
        xpath: string
        //关联参数
        param: DvTableJoinConfig
    }

    //此字段在 table 中的参数
    table: {
        //是否全局隐藏
        isHide: boolean
        //当前数据表中 是否显示此字段
        show: boolean
        //在数据表中 此字段显示宽度，int 求和后占比即为 % 宽度
        width: number
        //此字段是否在当前显示模式 mode 中定义要显示此字段
        defineInMode?: boolean

        [K: string]: any
    }

    //此字段在 form 中的参数
    form: {
        //是否全局隐藏
        isHide: boolean
        //当前表单中是否显示此字段
        show: boolean
        //validator 字段验证
        hasValidator: boolean
        //后端制定的 验证函数名，在 useDvColumnValidator 工具中已经预定义的验证函数
        //也可以是 验证函数体字符串，使用 new Function() 即可转为可执行方法
        validator?: string

        [K: string]: any
    }

    [K: string]: any
}
//数据模型完整的 schema 参数结构，可用于输出 table | form
export interface DvModelSchema {
    //模型元数据
    meta: {
        name: string
        title?: string
        desc?: string
    }
    //xpath
    xpath: string

    //table 通用数据
    table: {
        //显示模式 mode
        mode: string
        //是否仅显示未被逻辑删除的记录
        enableOnly: boolean
        //每页显示数据条数
        pagesize: number
        //DvTable 组件额外参数
        props?: Partial<DvTableProps>
        [K: string]: any
    }

    //form 通用参数
    form: {
        //表单类型 insert | update
        type: 'insert' | 'update'
        [K: string]: any
    }

    //各字段的 schema
    column: Record<string, DvColumnSchema>

    [K: string]: any
}
//可自定义的 字段 schema 生成函数类型
export type DvColumnSchemaCreator = (
    modelConfig: DvModelConfig,
    colk: string, //!! 可能是 主表字段名 col_name   也可能是关联表字段名 join_table|alias.col_name
    colc: DvColumnConfig,
    csch: DvColumnSchema,
) => DvColumnSchema | boolean
//调用 initModelSchema 方法时，传入的 schemaParams 的参数类型
export type DvModelSchemaCreateParams = {
    //table-schema 必须参数
    mode?: string

    //form-schema 必须参数
    type?: 'insert' | 'update'

    [K: string]: any
}
//默认的 模型 schema 参数
const defaultModelSchema: DvModelSchema = {
    meta: {
        name: '',
    },
    xpath: '',
    table: {
        mode: 'default',
        enableOnly: false,
        pagesize: 100,
        props: {
            rowHeight: 'default',
            fontSize: 'default',
            radius: true,
            columnFlex: 'center',
        },
    },
    form: {
        type: 'insert',
    },
    column: {
        //!! 定义所有字段通用的 默认 schema
        _common_: {
            meta: {
                name: '',
            },
            xpath: '',
            type: 'String',
            types: {
                def: 'varchar',
                db: 'VARCHAR',
                js: 'String',
                php: 'String',
            },
            isId: false,
            isGetter: false,
            isSort: false,
            isFilter: false,
            isSearch: false,
            isJoin: false,
            table: {
                isHide: false,
                show: false,
                width: 3,
            },
            form: {
                isHide: false,
                show: false,
                hasValidator: false,
            },
        },
    },
}

//db 数据库组件的 运行时参数类型
export interface DvDbRtConfig {
    [K: string]: any
}
//table 数据表运行时外观参数 结构
export interface DvTableRtStyle {
    tightness?: 'tight' | 'default' | 'loose'
    rowHeight?: number
    colPadding?: number
    footerHeight?: number
    colJustify?: string
    [K: string]: any
}
//table 数据表 运行时参数 结构，可持久化
export interface DvTableRtConfig {
    mode?: string //显示模式
    showColumns?: string[] //要显示的字段列表
    columnWidth?: {
        [K: string]: number
    }
    style?: DvTableRtStyle //table 组件的运行时外观参数
    enableOnly?: boolean //是否仅查询 生效的 记录(未被软删除的记录)
    joinTable?: boolean //是否查询关联表数据
    joinTables?: string[] //运行时查询关联表 表名|别名 数组
    pagesize?: number //记录集每页显示条目数
    [K: string]: any
}
//table 数据表 运行时某个字段的 配置参数结构
export interface DvTableRtColumnConfig {
    isJoinColumn: boolean
    table: DvModelConfig
    column: DvColumnConfig
    tbn: string //主表|关联表 表名 或 别名
    colk: string //主表字段直接写 字段名，关联表字段写：表名(或别名).字段名
}
//table 数据表 运行时实际显示的字段的 参数结构，用于模板循环输出
export interface DvTableRtColumnParam {
    name: string
    title: string
    desc?: string
    width?: number
    configWidth?: number
    type?: string
    sortable?: boolean
    filterable?: boolean
    isId?: boolean
    isJoinColumn?: boolean
    //如果是关联表字段
    joinTable?: string //关联表名 或 别名
    joinColumn?: string //关联字段名
    [K: string]: any
}

//数据库|数据表 运行时数据格式
export interface DvDbsRuntime {
    common: {
        db?: DvDbRtConfig
        table?: DvTableRtConfig
    }
    db: {
        [K: string]: DvDbRtConfig
    }
    table: {
        [K: string]: DvTableRtConfig
    }
}

export const useDvDbsStore = defineStore(
    'dvDbs',
    () => {
        //已初始化标记
        const inited = ref<boolean>(false)

        /**
         * 缓存所有使用到的 数据库数据表的 结构化参数
         * 过期时间 24 hr
         */
        const config = reactive<Record<string, DvDbConfig>>({})
        //所有 已加载的 数据库 名称数组
        const dbs = computed<string[]>(() => {
            return Object.keys(config)
        })
        //所有 已加载的 数据表 名称数组 'dbName/modelName'
        const models = computed<string[]>(() => {
            const dbns = dbs.value
            if (dbns.length <= 0) return []
            const mods: string[] = []
            for (const db of dbns) {
                const dbc = dvLoget(config, db)
                if (!dbc.models || dbc.models.length <= 0) continue
                const modns = dbc.models.map((i: string) => `${db}/${i}`)
                mods.push(...modns)
            }
            return mods
        })

        //expire 时长
        const expireIn = ref<number>(24 * 60 * 60 * 1000)
        //检查缓存是否过期
        const isExpired = (expireAt?: number): boolean => {
            return expireAt !== undefined && expireAt <= Date.now()
        }

        //判断 数据库 或 数据表 的 结构化参数 是否已被拉取，且未过期
        const isAvailable = (xpath: string): boolean => {
            const { db, model } = parseXpath(xpath)
            if (!db) return false
            let kpath = getKeyPath(xpath)
            const rtn = dvLoget(config, kpath, undefined)
            //如果不存在 缓存的 数据
            if (rtn === undefined) return false

            //再检查是否过期
            //const ct = Date.now()
            if (model) {
                //检查 dbConfig
                const dbc = dvLoget(config, db, undefined)
                return !dbc.expireAt ? false : !isExpired(dbc.expireAt) //dbc.expireAt > ct
            }

            return !rtn.expireAt ? false : !isExpired(rtn.expireAt) //rtn.expireAt > ct
        }

        //用户可用的 所有 数据模型列表，不持久化，每次登录后，同步一次
        const userModels = ref<Record<string, DvAvailableDbItem>>({})
        //快速判断 当前用户所有可用数据模型 是否为空
        const userHasModels = computed<boolean>(
            () => userModels.value !== undefined && dvIs.nemobj(userModels.value),
        )
        //将 userModels 转为可用于 select options 的数组
        const userModelsOptions = computed<{ label: string; value: string }[]>(() => {
            if (!userHasModels.value) return []
            const opts: { label: string; value: string }[] = []
            for (const dbn in userModels.value) {
                const dbc = userModels.value[dbn]
                if (!dbc) continue
                for (const modk in dbc.models) {
                    const modc = dbc.models[modk]
                    if (!modc) continue
                    opts.push({
                        label: modc.tpath,
                        value: modc.xpath,
                    })
                }
            }
            return opts
        })

        //数据库相关 下拉列表选项，持久化，24 hr
        //!! 可以从后端拉取，比如有些数据表可以被整个作为下拉选项
        const selectOptions = ref<DvDbSelectOptions>()

        //拉取
        //loading 标记
        const loading = ref<boolean>(false)
        const loadConfig = async (xpath: string, force?: boolean): Promise<boolean> => {
            if (loading.value) return false
            const { db } = parseXpath(xpath)
            if (!db) return false
            //当前缓存还未过期，如果不是 force == true 强制刷新，则不重复拉取
            if (isAvailable(db) === true && force !== true) return true

            //开始拉取
            loading.value = true
            const dbcApi = useDvRequest(`dbConfig/${db}`)
            //拉取时，默认忽略全局接口缓存
            const rtn = await dbcApi.requestNoCache()
            if (dbcApi.responseError(rtn)) {
                loading.value = false
                return false
            }

            //缓存
            const dbc = rtn as DvThisApiReturn<'dbConfig'>
            config[db] = {
                meta: dbc.meta,
                frontend: dbc.frontend,
                models: dbc.models,
                model: dbc.model,
                expireAt: newExpireAt(),
            }

            //await dvWait(100)
            //拉取结束
            loading.value = false
            return true
        }
        //远程加载 用户可用的 所有数据模型列表
        const loadUserModels = async (): Promise<boolean> => {
            if (useDvRuntimeStore().isLogin !== true) return false
            if (loading.value) return false
            loading.value = true
            //开始拉取此用户所有可用的 数据模型
            const api = useDvRequest(`dbAvailable`)
            const rtn = await api.request()
            if (api.responseError(rtn)) {
                userModels.value = {}
                loading.value = false
                return false
            } else {
                userModels.value = rtn as Record<string, DvAvailableDbItem>
                loading.value = false
                return true
            }
        }
        //远程加载 数据库相关 下拉列表选项，持久化
        const loadSelectOptions = async (force?: boolean): Promise<boolean> => {
            const sopts = selectOptions.value
            if (force !== true && sopts && sopts.expireAt > 0 && !isExpired(sopts.expireAt)) {
                return true
            }

            if (loading.value) return false
            loading.value = true

            //准备要替换的新数据
            const res: DvDbSelectOptions = {
                //自动添加默认数据
                enum: dvCopy(defaultDbEnum),
                tree: dvCopy(defaultDbTree),
                expireAt: 0,
            }

            //开始拉取所有可用 下拉列表选项
            const api = useDvRequest(`dbOptions`)
            const rtn = await api.requestNoCache()

            //接口查询结束后，自动生成 expireAt
            res.expireAt = newExpireAt()

            //!! 接口响应错误，直接使用默认值填充
            if (api.responseError(rtn)) {
                selectOptions.value = res
                loading.value = false
                return false
            }

            //接口响应正常，使用后端获取的 覆盖 默认数据
            const rtnEnum = (rtn as Record<string, any>)?.enum
            const rtnTree = (rtn as Record<string, any>)?.tree
            if (rtnEnum && dvIs.nemobj(rtnEnum)) {
                res.enum = dvExtend(false, res.enum, rtnEnum)
            }
            if (rtnTree && dvIs.nemobj(rtnTree)) {
                res.tree = dvExtend(false, res.tree, rtnTree)
            }
            selectOptions.value = res
            loading.value = false
            return true
        }

        //数据库|数据表 参数解析
        //获取 数据库|数据表 参数
        const getConfig = (
            xpath: string,
        ): DvDbConfig | DvModelConfig | DvColumnConfig | undefined => {
            return dvLoget(config, getKeyPath(xpath), undefined)
        }
        //获取 数据库|数据表 参数，如果不存在，则拉取
        const getConfigAsync = async (
            xpath: string,
            force?: boolean,
        ): Promise<DvDbConfig | DvModelConfig | DvColumnConfig | undefined> => {
            //如果指定 force 强制刷新，则强制拉取远程数据
            if (force === true) {
                const loadOk = await loadConfig(xpath, true)
                if (loadOk === true) {
                    return getConfig(xpath)
                } else {
                    return undefined
                }
            }

            //不指定强制刷新，则首先直接读取已有数据
            const cfg = getConfig(xpath)
            if (!cfg) {
                //如果不存在已有数据，则拉取
                const loadOk = await loadConfig(xpath)
                if (loadOk === true) {
                    return getConfig(xpath)
                } else {
                    return undefined
                }
            }
            return cfg
        }

        //各种 数据库|模型 参数获取方法
        //!! 这些方法在执行前必须确保已拉取了对应数据库的 config
        //!! 通常这些方法在组件内使用，需要确保组件接收 dbXpath 参数，并在初始化时要拉取一次数据库 config

        //从 数据表参数中，获取某个 mode 显示模式下的 所有要显示的 字段名列表
        //!! 定义在模型前端参数 modelConfig.front.table.mode[mode name].columns[] 中的
        //!! 如果未指定 filterHide = false 则还会从中去除全局隐藏的字段
        const getTableModeColumns = (
            xpath: string | DvModelConfig,
            mode?: string,
            filterHide?: boolean,
        ): string[] | undefined => {
            const cfg =
                typeof xpath === 'string'
                    ? (getConfig(xpath) as DvModelConfig)
                    : (xpath as DvModelConfig)
            if (!cfg) return undefined
            if (!mode || mode === '') mode = 'default'
            //table front 参数
            const tbc = cfg?.front?.table as DvTableFrontConfig
            //全局隐藏的 字段
            const colsHide = tbc?.hide ?? []
            //可选的 table modes
            const modes = (tbc?.mode ?? {}) as Record<string, DvTableMode>
            //模式指定的字段列表
            //!! SPF-Orm 框架已经处理过 mode.columns，一定存在
            let colsMode = [...(modes?.[mode]?.columns ?? [])]

            //如果指定筛选 hide 全局隐藏字段
            if (filterHide === undefined || filterHide === true) {
                colsMode = colsMode.filter((i: string) => !colsHide.includes(i))
            }

            //最终 实际显示的字段列表
            return colsMode
        }
        //从 数据表参数中，获取某个 mode 显示模式下的 所有字段名列表，不论是否要显示
        //!! 包含 物理字段，计算字段，以及当前 mode 模式下所有关联表的所有可用字段
        //!! 作为生成 modelSchema.column{} 的字段列表数据源
        const getTableModeAllColumns = (
            xpath: string | DvModelConfig,
            mode?: string,
        ): string[] | undefined => {
            const cfg =
                typeof xpath === 'string'
                    ? (getConfig(xpath) as DvModelConfig)
                    : (xpath as DvModelConfig)
            if (!cfg) return undefined
            if (!mode || mode === '') mode = 'default'
            //主表所有字段
            const cols = [...cfg.allColumns]
            //当前 mode 的参数
            const modec = cfg?.front?.table?.mode?.[mode] as DvTableMode
            //当前 mode 包含的关联表[]
            const jtbs = modec?.join ?? []

            //如果当前 mode 不包含关联表，直接返回
            if (jtbs.length <= 0) return cols

            //!! 如果当前 mode 包含关联表，依次读取各关联表的 allColumns
            //主表 xpath 解析，获取 db 名称
            const { db, model } = parseXpath(cfg.xpath)
            if (!db || !model) return undefined
            //数据库参数
            const dbcfg = config?.[db]
            if (!dbcfg) return undefined
            //主表的 join 参数
            const joinc = cfg?.join
            const jps = joinc?.param
            const jts = joinc?.tables ?? []
            if (!jps || jts.length <= 0) return undefined

            for (const k of jtbs) {
                //尝试获取关联表的 参数
                let jcfg = dbcfg.model?.[k]
                //参数不存在 表示 k 可能是别名，从主表的 join 参数中查找对应的真实表名
                if (!jcfg) {
                    //找不到关联表参数，跳过
                    if (!jts.includes(k) || !jps?.[k]) continue
                    //找到真实表名，获取关联表参数
                    jcfg = dbcfg.model?.[jps[k].table]
                    //未获取到，跳过
                    if (!jcfg) continue
                }
                //从关联表参数中 获取 allColumns 添加到 字段列表中
                //!! 需要附件 表名|别名 前缀
                const jcols = [...jcfg.allColumns].map((i: string) => `${k}.${i}`)
                cols.push(...jcols)
            }

            return cols
        }
        //从 数据表参数中，获取某个 mode 显示模式下的 join 关联表 表名|别名 数组
        const getTableModeJoinTables = (
            xpath: string | DvModelConfig,
            mode?: string,
        ): string[] | undefined => {
            const cfg =
                typeof xpath === 'string'
                    ? (getConfig(xpath) as DvModelConfig)
                    : (xpath as DvModelConfig)
            if (!cfg) return undefined
            if (!mode || mode === '') mode = 'default'
            //table front 参数
            const tbc = cfg?.front?.table as DvTableFrontConfig
            //可选的 table modes
            const modes = (tbc?.mode ?? {}) as Record<string, DvTableMode>
            //模式指定的 join 关联表 表名|别名 数组
            //!! SPF-Orm 框架已经处理过 mode.join 直接使用
            return modes?.[mode]?.join ?? []
        }
        //获取指定数据模型的 指定 mode 显示模式下的 所有关联表的 config
        //!! SPF-Orm 框架要求只能同库关联，因此一定可以获取到关联表参数
        //!! 如果 关联表有别名，则将别名也作为 键名
        const getJoinTableConfigs = (
            xpath: string | DvModelConfig,
        ): Record<string, DvModelConfig> | undefined => {
            const cfg =
                typeof xpath === 'string'
                    ? (getConfig(xpath) as DvModelConfig)
                    : (xpath as DvModelConfig)
            if (!cfg) return undefined
            //当前数据表启用的 join 关联表
            const joinc = cfg?.join ?? {}
            const jtbs = joinc?.tables ?? []
            const jps = joinc?.param ?? {}
            if (jtbs.length <= 0) return undefined

            const rtn: Record<string, DvModelConfig> = {}
            for (const jtbn of jtbs) {
                const jp = jps[jtbn] ?? null
                if (!jp) continue
                //jtbn 可能是别名，需要查找 真实表名
                const tbn = jp.table
                const jxpath = `${cfg.xpath.split('/')[0]}/${tbn}`
                const tbc = getConfig(jxpath)
                if (!tbc) continue
                rtn[tbn] = tbc as DvModelConfig
                //如果有别名
                if (tbn !== jtbn) {
                    //别名也写入
                    rtn[jtbn] = tbc as DvModelConfig
                }
            }
            return rtn
        }
        //获取指定模型的 指定关联表的 参数
        const getJoinTableConfig = (
            xpath: string | DvModelConfig,
            jtbn: string, //!! 可以是关联表的 真实表名 或 别名
        ): DvModelConfig | undefined => {
            const jtbcs = getJoinTableConfigs(xpath)
            if (!jtbcs) return undefined
            return jtbcs?.[jtbn]
        }

        /**
         * modelSchema 数据模型的 schema 参数
         * 用于 table|form|detail 等组件运行时的 显示参数
         * 如果某个数据模型开启了持久化，这里的参数将会被持久化到 dvAccount.config.modelSchema{} 中
         * 键名为：db_name/model_name 格式字符串
         */
        const modelSchema = ref<Record<string, DvModelSchema>>({
            //!! 定义所有数据模型通用的 默认 schema
            _common_: dvCopy(defaultModelSchema),
        })
        //创建某个模型的初始 schema 可以被 table|form|detail 组件内部修改
        const initModelSchema = (
            xpath: string | DvModelConfig,
            schemaParams?: DvModelSchemaCreateParams,
        ): void => {
            //获取模型参数
            const conf =
                typeof xpath === 'string'
                    ? (getConfig(xpath) as DvModelConfig)
                    : (xpath as DvModelConfig)
            //参数不存在直接返回
            if (!conf) return
            //模型显示模式 mode 默认是 default
            const mode = schemaParams?.mode ?? 'default'
            //!! 相同的 mode 模型显示模式，只能初始化一次
            if (modelSchema.value?.[conf.xpath] !== undefined) {
                if (modelSchema.value[conf.xpath]?.table?.mode === mode) {
                    return
                }
            }

            //默认值
            const dftsch = dvCopy(modelSchema.value._common_ ?? {}) as DvModelSchema
            const dftcsch = dvCopy(dftsch.column._common_ ?? {}) as DvColumnSchema
            //清除默认的 columnSchema
            dftsch.column = {}

            //将模型基本信息写入 schema
            dftsch.meta = { ...conf.meta }
            dftsch.xpath = conf.xpath
            dftsch.table.mode = mode

            //执行构建方法
            //获取全部可用字段列表，包含 物理字段，计算字段，以及可能存在的所有关联表字段
            const allcols = getTableModeAllColumns(conf, mode)
            if (!allcols || allcols.length <= 0) return
            //依次处理并生成每个字段的 schema
            for (const k of allcols) {
                //生成的初始 columnSchema
                let nsch: DvColumnSchema | boolean
                //对应字段的 原始参数
                let colc: DvColumnConfig

                //initColumnSchema 初始化
                //当前模型的 物理|计算 字段
                if (!k.includes('.')) {
                    //不在字段列表中则跳过
                    if (!conf.allColumns.includes(k) || !conf.column?.[k]) continue
                    colc = conf.column[k]
                    //生成初始 columnSchema
                    nsch = initColumnSchema(conf, k, colc, dvCopy(dftcsch))
                    //附加参数
                    nsch.isJoin = false
                }
                //关联表字段
                else {
                    const ka = k.split('.')
                    //关联表名，关联表字段名
                    const jtbn = ka?.[0] && ka[0] !== '' ? ka[0] : undefined
                    const jcol = ka?.[1] && ka[1] !== '' ? ka[1] : undefined
                    if (!jtbn || !jcol || !conf.join?.param?.[jtbn]) continue
                    //关联参数
                    const jps = dvCopy(conf.join.param[jtbn])
                    //关联表参数
                    const jtbc = getJoinTableConfig(conf.xpath, jtbn)
                    if (!jtbc || !jtbc.allColumns.includes(jcol) || !jtbc.column?.[jcol]) continue
                    colc = jtbc.column[jcol]
                    //生成初始 columnSchema
                    nsch = initColumnSchema(conf, k, colc, dvCopy(dftcsch))
                    //额外处理关联表的标题，在表头中显示时，关联表字段要显示为 关联表标题+关联表字段名
                    //关联表标题应在后端配置数据库时，在 join 关联参数中设置
                    if (!jps.title || jps.title === '' || jps.title === jtbn) {
                        nsch.meta.title = `${jtbc.meta.title}: ${nsch.meta.title}`
                    } else {
                        nsch.meta.title = `${jps.title}: ${nsch.meta.title}`
                    }
                    //附加参数
                    nsch.isJoin = true
                    nsch.join = {
                        meta: { ...jtbc.meta },
                        xpath: jtbc.xpath,
                        param: jps,
                    }
                }

                //将生成的 初始 columnSchema 写入 modelSchema
                dftsch.column[k] = nsch
            }

            //写入 modelSchema
            modelSchema.value[conf.xpath] = dftsch

            //同步到持久化数据
            syncConfig('to', 'modelSchema')
        }
        //为各字段自动填充一些通用参数，避免每个 schemaCreator 要手动合并这些参数
        const initColumnSchema = (
            modelConfig: DvModelConfig,
            colk: string, //!! 可能是 主表字段名 col_name   也可能是关联表字段名 join_table|alias.col_name
            colc: DvColumnConfig,
            osch?: DvColumnSchema,
        ): DvColumnSchema => {
            if (!osch) osch = {} as DvColumnSchema
            return dvExtend(
                {
                    meta: { ...colc.meta },
                    xpath: colc.xpath,
                    type: colc.type as DvColumnJsType,
                    types: { ...colc.types } as DvColumnTypeFull,
                    isId: colc.isId ?? false,
                    isGetter: colc.isGetter ?? false,
                    isSort: colc.isSort ?? false,
                    isFilter: colc.isFilter ?? false,
                    isSearch: colc.isSearch ?? false,

                    //默认 table 参数
                    table: {
                        isHide: colc.hideInTable,
                        //表中此字段的初始显示状态，物理字段 true  计算字段,关联表字段 false
                        show:
                            !colc.hideInTable &&
                            !colk.includes('.') &&
                            modelConfig?.columns.includes(colk),
                        //字段的定义宽度，默认 3
                        width: colc?.width ?? 3,
                    },

                    //默认 form 参数
                    form: {
                        isHide: colc.hideInForm,
                        //表单中此字段的初始显示状态
                        show:
                            !colc.hideInForm &&
                            !(colc.isId || colc.isPk || colc.isGetter) &&
                            !colk.includes('.'),
                        hasValidator: colc.hasValidator,
                        validator: colc.validator,
                    },
                } as DvColumnSchema,
                osch,
            )
        }
        //运行时修改 table 数据表的 schema 结构
        const editModelTableSchema = (
            modelConfig: DvModelConfig,
            mode: string,
            schemaCreator: DvColumnSchemaCreator,
            originSchema?: DvModelSchema, //在已有 schema 基础上 添加|删除 数据
        ): void => {
            const conf = dvCopy(modelConfig)
            //必须传入有效的 mode 显示模式
            if (!conf.front?.table?.mode?.[mode]) return
            //!! 必须存在一个初始的 modelSchema
            if (!originSchema) originSchema = modelSchema.value[conf.xpath]
            if (!originSchema) return
            //获取全部可用字段列表，包含 物理字段，计算字段，以及可能存在的所有关联表字段
            const allcols = getTableModeAllColumns(conf.xpath, mode)
            if (!allcols || allcols.length <= 0) return
            //复制原始 modelSchema 未传入则使用默认的
            const origin = dvCopy(originSchema) as DvModelSchema
            //准备 修改后的 schema
            const rtn: DvModelSchema = dvExtend(origin, {
                table: { mode },
                column: {},
            } as DvModelSchema)

            //依次处理并生成每个字段的 schema
            for (const k of allcols) {
                //生成的 columnSchema
                let nsch: DvColumnSchema | boolean
                //原始的 columnSchema
                let osch: DvColumnSchema
                //对应字段的 原始参数
                let colc: DvColumnConfig

                //当前模型的 物理|计算 字段
                if (!k.includes('.')) {
                    //不在字段列表中则跳过
                    if (!conf.allColumns.includes(k) || !conf.column?.[k]) continue
                    colc = conf.column[k]
                    //const colk = colc.meta.name
                    //原始的 columnSchema
                    osch = initColumnSchema(conf, k, colc, origin?.column?.[k])
                    nsch = schemaCreator(conf, k, colc, osch)
                    //附加参数
                    if (typeof nsch !== 'boolean') {
                        nsch.isJoin = false
                    }
                }

                //关联表字段
                else {
                    const ka = k.split('.')
                    //关联表名，关联表字段名
                    const jtbn = ka?.[0] && ka[0] !== '' ? ka[0] : undefined
                    const jcol = ka?.[1] && ka[1] !== '' ? ka[1] : undefined
                    if (!jtbn || !jcol || !conf.join?.param?.[jtbn]) continue
                    //关联参数
                    const jps = dvCopy(conf.join.param[jtbn])
                    //关联表参数
                    const jtbc = getJoinTableConfig(conf.xpath, jtbn)
                    if (!jtbc || !jtbc.allColumns.includes(jcol) || !jtbc.column?.[jcol]) continue
                    colc = jtbc.column[jcol]
                    //const colk = colc.meta.name
                    //原始的 columnSchema
                    osch = initColumnSchema(conf, k, colc, origin?.column?.[k])
                    //额外处理关联表的标题，在表头中显示时，关联表字段要显示为 关联表标题+关联表字段名
                    //关联表标题应在后端配置数据库时，在 join 关联参数中设置
                    if (!jps.title || jps.title === '' || jps.title === jtbn) {
                        osch.meta.title = `${jtbc.meta.title}: ${osch.meta.title}`
                    } else {
                        osch.meta.title = `${jps.title}: ${osch.meta.title}`
                    }
                    nsch = schemaCreator(conf, k, colc, osch)
                    //附加参数
                    if (typeof nsch !== 'boolean') {
                        nsch.isJoin = true
                        nsch.join = {
                            meta: { ...jtbc.meta },
                            xpath: jtbc.xpath,
                            param: jps,
                        }
                    }
                }

                //根据 creator 返回的结果
                if (nsch === true) {
                    rtn.column[k] = osch
                    continue
                }
                if (nsch === false) break
                rtn.column[k] = nsch
            }

            //写入 modelSchema
            modelSchema.value[conf.xpath] = rtn
            //同步到持久化数据
            syncConfig('to', 'modelSchema')
        }
        //运行时修改 form 数据表单的 schema 结构
        const editModelFormSchema = (
            modelConfig: DvModelConfig,
            type: 'insert' | 'update',
            schemaCreator: DvColumnSchemaCreator,
            originSchema?: DvModelSchema, //在已有 schema 基础上 添加|删除 数据
        ): DvModelSchema | undefined => {
            const conf = dvCopy(modelConfig)
            //!! 必须存在一个初始的 modelSchema
            if (!originSchema) originSchema = modelSchema.value[conf.xpath]
            if (!originSchema) return undefined
            //表单可用字段 只能是主表物理字段
            const allcols = [...conf.columns]
            if (!allcols || allcols.length <= 0) return undefined
            //复制原始 modelSchema 未传入则使用默认的
            const origin = dvCopy(originSchema) as DvModelSchema
            //准备 修改后的 schema
            const rtn: DvModelSchema = dvExtend(origin, {
                form: { type },
                column: {},
            } as DvModelSchema)

            //依次处理并生成每个字段的 schema
            for (const k of allcols) {
                const colc = conf.column?.[k]
                //计算字段，关联表字段不能在表单中编辑
                if (!colc || colc.isGetter === true) continue
                //原始 columnSchema
                const osch = initColumnSchema(conf, k, colc, origin.column?.[k])
                //生成
                const nsch = schemaCreator(conf, k, colc, osch)
                if (nsch === true) {
                    rtn.column[k] = osch
                    continue
                }
                if (nsch === false) break

                //自动附加参数
                //TODO: ...

                //写入结果
                rtn.column[k] = nsch
            }

            //写入 modelSchema
            modelSchema.value[conf.xpath] = rtn
            //同步到持久化数据
            syncConfig('to', 'modelSchema')
        }

        /**
         * 持久化
         */
        //将此 store 中的相关参数，持久化到 用户数据中
        const syncConfig = async (
            type: 'from' | 'to' = 'from',
            configKey: string = 'all',
        ): Promise<void> => {
            //必须在账号成功登录后执行
            if (useDvRuntimeStore().isLogin !== true) return

            //账号持久化数据
            const dvAccount = useDvAccountStore()
            const config = dvAccount.config
            if (!config?.modelSchema) config.modelSchema = {} as Record<string, any>
            if (!config?.dbs) config.dbs = {} as Record<string, any>

            //定义可以被用户个性化配置的 参数项目
            const configs: Record<string, any> = {
                expireIn,
                selectOptions,
                modelSchema,
            }
            const keys: string[] = Object.keys(configs)
            for (const key of keys) {
                //只同步指定的参数
                if (configKey !== 'all' && key !== configKey) continue

                //!! 单独处理 modelSchema
                if (key === 'modelSchema') {
                    if (type === 'from') {
                        //从持久化数据中 获取 config
                        //!! _common_ 通用参数一定会持久化
                        if (config.modelSchema?._common_ === undefined) {
                            config.modelSchema._common_ = modelSchema.value._common_
                        } else {
                            modelSchema.value._common_ = config.modelSchema._common_
                        }
                        //读取其他模型参数
                        for (const schk in config.modelSchema) {
                            if (schk === '_common_' || !config.modelSchema?.[schk]) continue
                            modelSchema.value[schk] = config.modelSchema[schk]
                        }
                    } else if (type === 'to') {
                        //将此处的 modelSchema 写入持久化数据
                        //!! 如果用户数据中不包含某个模型的 schema 表示未开启持久化，不处理
                        for (const schk in modelSchema.value) {
                            if (!modelSchema.value?.[schk]) continue
                            if (config.modelSchema?.[schk] === undefined) continue
                            config.modelSchema[schk] = modelSchema.value[schk]
                        }
                    }
                    continue
                }
                //其他参数
                if (type === 'from') {
                    //从持久化数据中 获取 config
                    if (config.dbs?.[key] === undefined) {
                        //没有个性化配置，则写入
                        config.dbs[key] = configs[key].value
                    } else if (config.dbs[key] !== configs[key].value) {
                        //存在个性化配置，则从个性化配置中获取
                        configs[key].value = config.dbs[key]
                    }
                } else if (type === 'to') {
                    //将 runtime 中的参数 写入 持久化数据中
                    config.dbs[key] = configs[key].value
                }
            }
            await dvWait(100)
        }
        //恢复默认设置，如果用户已登录，则同时恢复持久化设置
        const restoreConfig = async (): Promise<void> => {
            //先恢复默认设置
            expireIn.value = 24 * 60 * 60 * 1000
            selectOptions.value = undefined

            await dvWait(100)
            await syncConfig('to')
        }

        /**
         * 在 数据库|数据表 组件内的运行时数据（运行时缓存的 相关配置参数）
         * 部分参数会被持久化到当前账号的 dvAccount.config.dbs{...} 中
         */
        const runtime = reactive<DvDbsRuntime>({
            //通用参数，会在 数据库|数据表 运行时参数初始化时，作为默认参数
            //会被持久化到 dvAccount.config.dbs.common{...}
            //用户可以通过 全局设置中心 配置这些参数
            common: {
                //数据表 通用参数
                table: {
                    mode: 'default',
                    enableOnly: false,
                    joinTable: true,
                    joinTables: [],
                    pagesize: 100,
                    style: {
                        tightness: 'default',
                        colJustify: 'flex-start',
                    },
                    //参数可选项
                    options: {
                        //可选的 数据表显示样式
                        style: {
                            tight: {
                                tightness: 'tight',
                                rowHeight: 24,
                                colPadding: 6,
                                footerHeight: 40,
                            },
                            default: {
                                tightness: 'default',
                                rowHeight: 32,
                                colPadding: 8,
                                footerHeight: 48,
                            },
                            loose: {
                                tightness: 'loose',
                                rowHeight: 48,
                                colPadding: 12,
                                footerHeight: 64,
                            },
                        },
                    },
                },
            },
            db: {
                //任意数据库的 运行时参数，缓存在这里
                //如果指定要持久化某个数据库参数，则持久化到 dvAccount.config.dbs.db.[dbn]{...}
            },
            table: {
                //任意数据表的 运行时参数，缓存在这里
                //如果指定要持久化某个数据表参数，则持久化到 dvAccount.config.dbs.table.[dbn].[tbn]{...}
            },
        })
        //直接通过 dbn tbn 获取 rt 运行时，可能不存在
        const logetRt = (xpath: string): DvDbRtConfig | DvTableRtConfig | undefined => {
            if (!xpath || xpath === '') return undefined
            const isTable = xpath.includes('/')
            let dbn!: string, tbn!: string
            if (isTable) {
                const xps = xpath.split('/').slice(0, 2)
                if (xps[0] && xps[0] !== '') dbn = xps[0]
                if (xps[1] && xps[1] !== '') tbn = xps[1]
                if (!dbn || !tbn) return undefined
            } else {
                dbn = xpath
            }

            //rt 数据
            return isTable
                ? (runtime.table?.[dbn]?.[tbn] as DvTableRtConfig)
                : (runtime.db?.[dbn] as DvDbRtConfig)
        }
        //获取 数据库|数据表 的 运行时参数，如果不存在，则初始化
        const getRt = async (
            xpath: string,
        ): Promise<DvDbRtConfig | DvTableRtConfig | undefined> => {
            if (!xpath || xpath === '') return undefined
            const isTable = xpath.includes('/')
            let dbn!: string, tbn!: string
            if (isTable) {
                const xps = xpath.split('/').slice(0, 2)
                if (xps[0] && xps[0] !== '') dbn = xps[0]
                if (xps[1] && xps[1] !== '') tbn = xps[1]
                if (!dbn || !tbn) return undefined
            } else {
                dbn = xpath
            }

            //rt 数据
            const rt = isTable ? runtime.table?.[dbn]?.[tbn] : runtime.db?.[dbn]
            if (rt && dvIs.nemobj(rt)) return rt

            //rt 数据不存在，初始化
            if (isTable) {
                //使用默认值
                if (!runtime.common?.table) return undefined
                const common = dvCopy(runtime.common.table) as DvTableRtConfig
                if (common?.options) delete common.options
                //写入默认值，自动生成完整的 table 运行时
                //!! 初始化后，需要持久化一次
                await setRt(xpath, common, true)
                //返回
                return runtime.table?.[dbn]?.[tbn]
            }

            //初始化 数据库 参数
            if (!runtime.common?.db) return undefined
            const common = dvCopy(runtime.common.db) as DvDbRtConfig
            if (common?.options) delete common.options
            //写入默认值，自动生成完整的 db 运行时
            //!! 初始化后，需要持久化一次
            await setRt(xpath, common, true)
            //返回
            return runtime.db?.[dbn]
        }
        //数据库|数据表 runtime 参数修改方法
        const rtSetting = ref<boolean>(false)
        const setRt = async (
            xpath: string,
            rt?: DvDbRtConfig | DvTableRtConfig,
            syncToAccount?: boolean,
        ): Promise<boolean> => {
            if (rtSetting.value === true || xpath === '' || !rt || !dvIs.nemobj(rt)) return false
            rtSetting.value = true

            //修改 common 通用参数
            if (xpath === 'common') {
                //合并
                //!! dvExtend 数组使用 覆盖方式 合并，而不是 合并去重
                runtime.common = dvExtend(false, runtime.common, rt)
                await dvWait(10)
                rtSetting.value = false
                return syncToAccount ? await syncRt('to') : true
            }

            const isTable = xpath.includes('/')

            //修改 数据表 的运行时参数
            if (isTable) {
                const xps = xpath.split('/').slice(0, 2)
                const dbn = xps[0]
                const tbn = xps[1]
                if (!dbn || !tbn || dbn === '' || tbn === '') return false
                //要写入的 新数据，通过 generateTableRt() 方法处理
                const nrt = generateTableRt(xpath, rt) as DvTableRtConfig
                if (nrt) {
                    //合并
                    //!! dvExtend 数组使用 覆盖方式 合并，而不是 合并去重
                    runtime.table = dvExtend(false, runtime.table, {
                        [dbn]: {
                            [tbn]: nrt,
                        },
                    }) as {
                        [K: string]: DvTableRtConfig
                    }
                    await dvWait(10)
                    rtSetting.value = false
                    return syncToAccount ? await syncRt('to', xpath) : true
                } else {
                    rtSetting.value = false
                    return false
                }
            }

            //修改 数据库 的运行时参数
            const nrt = generateDbRt(xpath, rt)
            if (nrt) {
                //合并
                //!! dvExtend 数组使用 覆盖方式 合并，而不是 合并去重
                runtime.db = dvExtend(false, runtime.db, {
                    [xpath]: nrt,
                }) as { [K: string]: DvDbRtConfig }
                await dvWait(10)
                rtSetting.value = false
                return syncToAccount ? await syncRt('to', xpath) : true
            } else {
                rtSetting.value = false
                return false
            }
        }
        //重置某个 数据库|数据表 的 rt 运行时参数
        const resetRt = async (xpath: string, syncToAccount?: boolean): Promise<boolean> => {
            if (xpath === '') return false
            const { db: dbn, model: tbn } = parseXpath(xpath)
            if (!dbn) return false
            const isTable = dbn && tbn && dbn !== '' && tbn !== ''
            if (isTable) {
                delete runtime.table?.[dbn]?.[tbn]
            } else {
                delete runtime.db?.[dbn]
            }
            //通过 getRt 方法，自动创建默认参数
            const rt = await getRt(xpath)
            if (!rt) return false
            return true
        }
        //runtime 数据持久化，to = 写入持久化数据，from = 从持久化数据中读取
        const rtSyncing = ref<boolean>(false)
        const syncRt = async (type: 'to' | 'from' = 'from', xpath?: string): Promise<boolean> => {
            //用户必须已登录，且不能在 syncing 中
            if (useDvRuntimeStore().isLogin !== true || rtSyncing.value === true) return false
            rtSyncing.value = true
            const dvAccount = useDvAccountStore()
            if (!dvAccount.config?.dbs) {
                dvAccount.config.dbs = {}
            }
            const config = dvAccount.config.dbs as DvDbsRuntime

            //处理 common 数据
            let isinit = false
            if (!config?.common || !dvIs.nemobj(config.common)) {
                //持久化数据中还没有 common 则写入，这是用户首次登录后会执行的动作
                config.common = dvCopy(runtime.common)
                isinit = true
            }
            if (!isinit) {
                if (type === 'from') {
                    //从持久化数据中读取
                    await setRt('common', dvCopy(config.common))
                } else {
                    //写入持久化数据
                    config.common = dvCopy(runtime.common)
                }
            }

            //如果未指定 xpath 则仅处理 common 此处直接退出
            if (!xpath || xpath === '') {
                rtSyncing.value = false
                return true
            }

            //如果指定 xpath == 'all' 则处理所有 已有的 数据库|数据表 rt 参数
            //!! 通常用于 用户登录后，从持久化数据中 同步到 dvDbs store
            if (xpath === 'all') {
                if (type === 'from') {
                    if (config?.db) runtime.db = dvCopy(config.db)
                    if (config?.table) runtime.table = dvCopy(config.table)
                } else if (type === 'to') {
                    config.db = dvCopy(runtime.db)
                    config.table = dvCopy(runtime.table)
                }
                rtSyncing.value = false
                return true
            }

            //如果指定 xpath 则处理 对应的 数据库|数据表 数据
            const isTable = xpath.includes('/')
            let dbn!: string, tbn!: string
            if (isTable) {
                const xps = xpath.split('/').slice(0, 2)
                if (xps[0] && xps[0] !== '') dbn = xps[0]
                if (xps[1] && xps[1] !== '') tbn = xps[1]
                if (!dbn || !tbn) {
                    rtSyncing.value = false
                    return false
                }
            } else {
                dbn = xpath
            }

            //要写入的 rt 数据
            const rt = isTable ? runtime.table?.[dbn]?.[tbn] : runtime.db?.[dbn]
            if (!rt || !dvIs.nemobj(rt)) {
                rtSyncing.value = false
                return false
            }

            //写入 持久化数据的 方法
            const setAcRt = (): void => {
                if (isTable) {
                    if (!config?.table) config.table = {}
                    config.table = dvExtend(false, config.table, {
                        [dbn]: {
                            [tbn]: rt,
                        },
                    }) as { [K: string]: DvTableRtConfig }
                } else {
                    if (!config?.db) config.db = {}
                    config.db = dvExtend(false, config.db, { [dbn]: rt }) as {
                        [K: string]: DvDbRtConfig
                    }
                }
            }

            //检查是否已有持久化数据
            isinit = false
            const ort = isTable ? config?.table?.[dbn]?.[tbn] : config?.db?.[dbn]
            if (!ort) {
                //还没有持久化数据，则写入
                setAcRt()
                //标记这是 init
                isinit = true
            }
            if (!isinit) {
                if (type === 'from') {
                    //从持久化数据中读取
                    await setRt(xpath, ort)
                } else {
                    //写入持久化数据
                    setAcRt()
                }
            }

            //状态缓冲
            await dvWait(50)
            rtSyncing.value = false
            return true
        }
        //数据库 rt 参数创建方法，根据已有参数，自动生成全部参数
        const generateDbRt = (xpath: string, rt?: DvDbRtConfig): DvDbRtConfig | undefined => {
            if (!rt || !dvIs.nemobj(rt)) return undefined
            //xpath
            if (!xpath || xpath.includes('/')) return undefined
            //TODO: ...
            return rt
        }
        //数据表 rt 参数创建方法，根据已有参数，自动生成全部参数
        const generateTableRt = (
            xpath: string,
            rt?: DvTableRtConfig,
        ): DvTableRtConfig | undefined => {
            if (!rt || !dvIs.nemobj(rt)) return undefined
            //xpath
            if (!xpath || !xpath.includes('/')) return undefined

            //依次处理
            //rtMode
            if (rt?.mode && rt.mode !== '') {
                //rt.showColumns[]
                if (!rt?.showColumns || rt.showColumns.length <= 0) {
                    const cols = getTableModeColumns(xpath, rt.mode)
                    if (cols && cols.length > 0) {
                        rt.showColumns = [...cols]
                    }
                }
                //rt.joinTables
                rt.joinTables = getTableModeJoinTables(xpath, rt.mode)
            }
            //rtStyle
            if (rt?.style && dvIs.nemobj(rt.style)) {
                const tightness = rt.style?.tightness
                const options = runtime.common?.table?.options?.style
                if (tightness && options && options?.[tightness]) {
                    for (const k in options[tightness]) {
                        rt.style[k] = options[tightness][k]
                    }
                }
            }

            //返回处理后得到的 DvTableRtConfig
            return rt
        }

        //工具方法

        /**
         * 数据库的结构化参数，查询入参格式统一为路径形式：dbName/modelName/columnName 最多三层
         * 此方法统一解析此路径结构，返回 对应的 dbName,modelName?,columnName?
         * 路径分隔符可以是：. 或 \ 或 /
         */
        const parseXpath = (xpath: string): { db?: string; model?: string; column?: string } => {
            const xa = dvTrimAny(xpath.replace(/[.\\]/g, '/'), '/').split('/')
            if (!xa || xa.length <= 0) return {}
            return {
                db: xa[0],
                model: xa[1],
                column: xa[2],
            }
        }
        /**
         * 根据传入的 xpath 解析得到有效的 键名序列字符串
         * 用于 从 config 源数据中 dvLoget 对应的 数据库|表|字段 的 实际参数值
         * 返回的 键名序列字符串形式 dbName.model.modelName.column.columnName
         */
        const getKeyPath = (xpath: string): string => {
            const { db, model, column } = parseXpath(xpath)
            const kp: string[] = []
            if (db) kp.push(db)
            if (model) kp.push('model', model)
            if (column) kp.push('column', column)
            return kp.join('.')
        }
        //返回过期时间戳
        const newExpireAt = (time?: number): number => {
            const expire = expireIn.value
            if (time) return time + expire
            return Date.now() + expire
        }

        //在用户登录成功后 执行
        const initAfterLoginOk = async (): Promise<void> => {
            if (useDvRuntimeStore().isLogin !== true) return

            //开始拉取 全局下拉列表数据
            await loadSelectOptions()

            //开始拉取此用户所有可用的 数据模型
            await loadUserModels()

            //同步 持久化参数
            await syncConfig('from')
            //await syncRt('from', 'all')
        }

        //初始化 store
        const initStore = (app: App, options: Record<string, any> = {}): void => {}

        //自动更新接口返回 对应数据后，写入 store
        const updateStore = (updata: Record<string, any>): void => {}

        return {
            inited,

            expireIn,
            config,
            dbs,
            models,
            isAvailable,
            userModels,
            userHasModels,
            userModelsOptions,

            selectOptions,

            loading,
            loadConfig,
            loadUserModels,
            loadSelectOptions,

            getConfig,
            getConfigAsync,
            getTableModeColumns,
            getTableModeAllColumns,
            getTableModeJoinTables,
            getJoinTableConfigs,
            getJoinTableConfig,

            modelSchema,
            initModelSchema,
            initColumnSchema,
            editModelTableSchema,
            editModelFormSchema,

            syncConfig,
            restoreConfig,

            runtime,
            logetRt,
            getRt,
            rtSetting,
            setRt,
            resetRt,
            rtSyncing,
            syncRt,

            parseXpath,
            getKeyPath,

            initAfterLoginOk,

            initStore,
            updateStore,
        }
    },
    {
        persist: {
            //dvDbs store 使用固定 key
            key: 'dv:dvDbs',
            //要持久化的 数据
            pick: ['config', 'selectOptions'],
        },
    },
)
