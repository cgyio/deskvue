/**
 * Deskvue JS工具方法
 */

//dvIs 类型判断
const _dvis = (anything: unknown, type?: string): string | boolean => {
    let mytype = Object.prototype.toString.call(anything).slice(8, -1).toLowerCase()

    // 特殊对象类型修正
    if (mytype === 'object') {
        if (anything instanceof Set) {
            mytype = 'set'
        } else if (anything instanceof Map) {
            mytype = 'map'
        } else if (anything === null) {
            mytype = 'null'
        }
    }

    // 未传入类型参数，直接返回类型字符串
    if (typeof type === 'undefined') return mytype

    // 类型参数非字符串，递归获取其类型
    if (typeof type !== 'string') {
        type = _dvis(type) as string
    }

    type = type.toLowerCase()

    // 多类型匹配
    if (type.includes(',')) {
        const types = type.split(',')
        return types.includes(mytype)
    }

    // 单类型精确匹配
    return (
        (type === 'null' && anything === null) ||
        (type === 'number' && !isNaN(parseInt(anything as string))) ||
        mytype === type
    )
}
type _extendDvis = { [K: string]: any }
export const dvIs = new Proxy<typeof _dvis & _extendDvis>(_dvis, {
    get(target, prop: string | symbol) {
        if (typeof prop !== 'string') return undefined
        const props = {
            types: [
                'undefined',
                'null',
                'object',
                'array',
                'function',
                'asyncfunction',
                'boolean',
                'string',
                'number',
                'symbol',
                'set',
                'map',
            ],
            nonObjectTypes: ['boolean', 'string', 'number', 'symbol'],
            emptyObjectTypes: ['undefined', 'null'],
            eachTypes: ['array', 'object', 'set', 'map', 'string'],

            defined: (anything: unknown): boolean => !_dvis(anything, 'undefined'),
            plainObject: (anything: unknown): boolean => !!_dvis(anything, 'object'),
            nonObject: (anything: unknown): boolean =>
                dvIs.nonObjectTypes.includes(_dvis(anything) as string),
            noeo: (anything: unknown): boolean =>
                dvIs.nonObject(anything) || dvIs.emptyObject(anything),
            empty: (anything: unknown): boolean => {
                const type = _dvis(anything) as string
                switch (type) {
                    case 'undefined':
                    case 'null':
                        return true
                    case 'array':
                    case 'string':
                        return (anything as any).length <= 0
                    case 'number':
                        return isNaN(anything as number)
                    case 'object':
                        return Object.keys(anything as object).length <= 0
                    case 'set':
                    case 'map':
                        return (anything as Set<any> | Map<any, any>).size <= 0
                    default:
                        return false
                }
            },
            nemstr: (anything: unknown): boolean =>
                dvIs.string(anything) && !dvIs.empty(anything as string),
            nemarr: (anything: unknown): boolean =>
                dvIs.array(anything) && !dvIs.empty(anything as any[]),
            nemobj: (anything: unknown): boolean =>
                dvIs.plainObject(anything) && !dvIs.empty(anything as object),
            // 12px 100% --> true
            numeric: (anything: unknown): boolean => {
                if (dvIs.string(anything))
                    return new RegExp('^\\-?[\\d.]{1,}').test(anything as string)
                if (dvIs.number(anything)) return !isNaN((anything as number) * 1)
                return false
            },
            // 纯数字字符串 --> true
            realNumber: (anything: unknown): boolean =>
                (dvIs.number(anything) || dvIs.string(anything)) &&
                !isNaN((anything as number) * 1),
            integer: (anything: unknown): boolean =>
                isFinite(anything as number) &&
                parseInt(anything as string) === (anything as number) * 1,
            float: (anything: unknown): boolean =>
                isFinite(anything as number) &&
                parseInt(anything as string) !== (anything as number) * 1,
            json: (anything: unknown): boolean => {
                if (!dvIs.string(anything)) return false
                try {
                    JSON.parse(anything as string)
                    return true
                } catch (e) {
                    return false
                }
            },
            datetimeString: (anything: unknown): boolean => {
                if (!dvIs.nemstr(anything)) return false
                const d = new Date(anything as string)
                return d instanceof Date && !isNaN(d.getTime())
            },
            //!! 时间戳判断，当前时间前后 20 年作为上下限，超出的数字，不作为时间戳
            timestamp: (anything: unknown, ms?: boolean): boolean => {
                if (!dvIs.realNumber(anything)) return false
                const ts = (anything as number) * 1
                //设定上下限，避免将普通数字判断为 timestamp
                //!! 当前时间前后 20 年作为 上下限
                let limit = 3600 * 24 * 365 * 20
                if (ms ?? false) limit = limit * 1000
                const now = (ms ?? false) ? Date.now() : Math.floor(Date.now() / 1000)
                const min = now - limit
                const max = now + limit
                if (ts < min || ts > max) return false
                //秒|毫秒 判断
                const isMs = ms ?? ts > 9999999999
                const d = new Date(isMs ? ts : ts * 1000)
                return d instanceof Date && !isNaN(d.getTime())
            },
            instance: (anything: unknown, cls: new (...args: any[]) => any): boolean =>
                anything instanceof cls,
            elm: (anything: unknown): boolean => anything instanceof HTMLElement,
        }

        // 返回预设工具方法
        if (Object.keys(props).includes(prop)) return props[prop as keyof typeof props]
        // 返回类型判断快捷方法（is.string / is.array 等）
        if (props.types.includes(prop)) {
            return (anything: unknown) => target(anything, prop)
        }

        return undefined
    },
})

/**
 * dvExtend 深拷贝
 * 类型安全版 深拷贝 方法（jQuery.extend 逻辑）
 *
 * !! 一定是 深拷贝
 *
 * !! 第一个参数 是 boolean 时，决定：数组使用 合并去重 还是 覆盖 方式合并
 * !!   true    --> 默认，合并去重
 * !!   false   --> 数组覆盖
 *
 * !! 对象：递归合并
 *
 * !! 如果某个键值是 '__delete__' 则从源数据中删除此键
 */
export function dvExtend<T extends object, U = unknown, V = unknown, W = unknown>(
    ...params: (boolean | T | U | V | W)[]
): T {
    let options: any
    let name: string
    let src: any
    let copy: any
    let copyIsArray = false
    let clone: any

    // 目标对象
    let target = params[0] ?? ({} as PlainObject)
    let i = 1
    const length = params.length
    let arrayMerge = true // 数组合并方式，默认合并去重

    // 处理第一个参数是 boolean 的情况（决定 数组的合并方式）
    if (typeof target === 'boolean') {
        arrayMerge = target as boolean
        target = params[1] ?? ({} as PlainObject)
        i = 2
    }

    // 如果 target 不是对象/函数，强制变成空对象
    if (typeof target !== 'object' && !dvIs.function(target)) {
        target = {} as PlainObject
    }

    // 如果只有一个参数，合并到 {}  //this 上
    if (length === i) {
        target = {} as PlainObject //this
        i--
    }

    // 遍历所有源对象
    for (; i < length; i++) {
        if ((options = params[i]) == null) continue

        for (name in options) {
            src = (target as PlainObject)[name]
            copy = options[name]

            // 防止循环引用
            if (target === copy) continue

            // 处理 对象 / 数组
            if (copy != null && (dvIs.plainObject(copy) || (copyIsArray = dvIs.array(copy)))) {
                if (copyIsArray) {
                    copyIsArray = false

                    if (arrayMerge === true) {
                        //!! 使用 合并去重的方式 合并数组
                        // 原是数组则用原数组，否则新建数组
                        clone = src && dvIs.array(src) ? src : []
                        //合并
                        clone.push(...copy)
                        //去重
                        ;(target as PlainObject)[name] = [...new Set(clone)]
                    } else {
                        //!! 使用 覆盖的方式 合并数组
                        ;(target as PlainObject)[name] = [...copy]
                    }
                } else {
                    // 对象递归合并
                    clone = src && dvIs.plainObject(src) ? src : ({} as PlainObject)
                    ;(target as PlainObject)[name] = dvExtend(arrayMerge, clone, copy)
                }
            }
            // 标量：直接赋值
            else if (copy !== undefined) {
                //!! __delete__ 标记
                if (copy === '__delete__') {
                    if (name in (target as PlainObject)) {
                        delete (target as PlainObject)[name]
                    }
                } else {
                    ;(target as PlainObject)[name] = copy
                }
            }
        }
    }

    return target as T
}

//dvCopy 快速复制一个 plainObject
export const dvCopy = <T extends object>(obj: T): T => {
    return dvExtend(true, {} as T, obj) as T
}

//dvWrap 按照 [foo, 0, bar, jaz] 键链 将值包裹为 多层 {}
//支持传入 字符串格式的 键链，支持的分隔符 . 或 /
export const dvWrap = (
    kc: string | (string | number)[],
    val: any,
): PlainObject | any[] | undefined => {
    if (kc.length <= 0) return undefined
    //字符串键链转为 []
    let ks: (string | number)[] = typeof kc === 'string' ? kc.split(/[./]/) : [...kc]
    //将 kc 中的数字 转为真实数字
    ks = ks.map((i: string | number) => {
        if (typeof i === 'number') return Math.floor(i)
        const n = parseInt(i)
        if (!isNaN(n)) return n
        return i
    })

    //准备输出值
    let rtn: any = val
    for (let i = ks.length - 1; i >= 0; i--) {
        const ki = ks[i]
        if (ki === undefined) continue

        //数字键
        if (typeof ki === 'number') {
            const temp = []
            temp[ki] = rtn
            rtn = temp
            continue
        }

        //字符键
        else if (typeof ki === 'string') {
            const temp = {} as PlainObject
            temp[ki] = rtn
            rtn = temp
            continue
        }
    }

    return rtn
}

//无单位数值的 css 属性（值为数字时不补 px）
const DV_CSS_UNITLESS: string[] = [
    'animation-iteration-count',
    'aspect-ratio',
    'border-image-outset',
    'border-image-slice',
    'border-image-width',
    'box-flex',
    'box-flex-group',
    'box-ordinal-group',
    'column-count',
    'columns',
    'fill-opacity',
    'flex',
    'flex-grow',
    'flex-negative',
    'flex-order',
    'flex-positive',
    'flex-shrink',
    'flood-opacity',
    'font-weight',
    'grid-area',
    'grid-column',
    'grid-column-end',
    'grid-column-span',
    'grid-column-start',
    'grid-row',
    'grid-row-end',
    'grid-row-span',
    'grid-row-start',
    'line-clamp',
    'line-height',
    'opacity',
    'order',
    'orphans',
    'scale',
    'stop-opacity',
    'stroke-dasharray',
    'stroke-dashoffset',
    'stroke-miterlimit',
    'stroke-opacity',
    'stroke-width',
    'tab-size',
    'widows',
    'z-index',
    'zoom',
]
//将键名转为 css 属性名
//  fontSize         --> font-size
//  WebkitTransform  --> -webkit-transform
//  msTransform      --> -ms-transform
//  --dv-color       --> --dv-color（css 变量与已带分隔符的键原样保留）
const dvCssProp = (key: string): string => {
    if (key.startsWith('--') || key.includes('-')) return key.toLowerCase()
    return key
        .replace(/^ms(?=[A-Z])/, 'Ms')
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
}
/**
 * 将标准的 css-object 转为 css 声明字符串（可直接用于 style 属性）
 *      dvCssstr({ fontSize: '12px', color: 'red' })        --> 'font-size:12px;color:red;'
 *      dvCssstr({ width: 64, opacity: 0.5 })               --> 'width:64px;opacity:0.5;'
 *      dvCssstr({ display: undefined, color: 'red' })      --> 'color:red;'
 *      dvCssstr('color:red; font-size:12px')               --> 'color:red;font-size:12px;'
 *      dvCssstr([{ color: 'red' }, 'width:64px'])          --> 'color:red;width:64px;'
 *
 * !! 数值默认补 px，无单位属性（opacity|z-index|line-height|flex 等）与 css 变量除外
 * !! 值为 undefined | null | false | '' 的声明会被跳过
 */
export const dvCssstr = (source?: PlainObject | string | (PlainObject | string)[]): string => {
    if (source == null) return ''

    //字符串：规范化声明串（trim、去空、补分号）
    if (dvIs.string(source)) {
        const decls = (source as string)
            .split(';')
            .map((s: string) => s.trim())
            .filter((s: string) => s !== '')
        return decls.length > 0 ? `${decls.join(';')};` : ''
    }

    //数组：按顺序拼接
    if (dvIs.array(source)) {
        return (source as (PlainObject | string)[])
            .map((s) => dvCssstr(s))
            .filter((s) => s !== '')
            .join('')
    }

    //对象：逐个声明转换
    const decls: string[] = []
    for (const key of Object.keys(source as PlainObject)) {
        const prop = dvCssProp(key)
        const value = (source as PlainObject)[key]

        //跳过 无效值
        if (
            value === undefined ||
            value === null ||
            value === '' ||
            typeof value === 'boolean'
        )
            continue

        //数值：补 px（css 变量与无单位属性除外）
        let val = value
        if (typeof value === 'number') {
            val =
                prop.startsWith('--') || DV_CSS_UNITLESS.includes(prop)
                    ? String(value)
                    : `${value}px`
        }
        decls.push(`${prop}:${val}`)
    }
    return decls.length > 0 ? `${decls.join(';')};` : ''
}

/**
 * 实现 lodash 的 根据 键名序列字符串，从源数据中 获取对应的 键值
 * 支持 . 和 / 分隔符
 *      dvLoget(source, 'foo.bar.3.jaz', defaultValue)
 *      dvLoget(source, 'foo/bar/3/jaz', defaultValue)
 *      dvLoget(source, ['foo', 'bar', 3, 'jaz'], defaultValue)
 */
export const dvLoget = (
    source: PlainObject | any[],
    key: string | (string | number)[],
    defaultValue?: any,
): any => {
    if (dvIs.empty(key)) return defaultValue
    if (!dvIs.plainObject(source) && !dvIs.array(source)) return defaultValue
    //键名数组
    let keys: (string | number)[] = []
    if (dvIs.array(key)) {
        keys = [...key]
    } else {
        keys = (key as string).split(/[./]/).filter((k: string) => k !== '')
    }

    let result: any = source
    for (const k of keys) {
        if (result == null || (!dvIs.plainObject(result) && !dvIs.array(result))) {
            return defaultValue
        }
        result = result[k]
    }

    return result !== undefined ? result : defaultValue
}

//dvWait 等待
export const dvWait = (time: number = 300, returnValue?: any): Promise<any> => {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, time, returnValue)
    })
}

//dvUntil 直到满足条件
export const dvUntil = (
    condition: () => boolean,
    waittime: number = 2000,
    timegap: number = 100,
): Promise<boolean> => {
    let timeto = 0 //已等待时间
    return new Promise((resolve, reject) => {
        if (typeof condition !== 'function') {
            return reject(false)
        }
        const f = () => {
            if (timeto > waittime) return reject(false)
            timeto += timegap
            if (condition() === true) return resolve(true)
            return setTimeout(f, timegap)
        }
        return f()
    })
}

/**
 * dvDefer
 * 创建一个 Promise，返回 { promise, resolve, reject }
 * 外部可通过 调用 resolve|reject 让 promise 结束
 * 例如：
 *  const defer = dvDefer()
 *  const someAsync = async () => {
 *      try {
 *          const rtn = defer.promise
 *          ... 外部执行了 defer.resolve(rtnValue) 成功获取 rtn = rtnValue
 *      } catch(err) {
 *          ... 外部执行了 defer.reject()
 *      }
 *  }
 *
 *  外部执行：
 *  defer.resolve(rtnValue)
 *  或
 *  defer.reject()
 */
export type ResolveFn<T> = (val: T) => void
export type RejectFn = (reson?: any) => void
export interface DvDefer<T> {
    promise: Promise<T>
    resolve: (val: T) => void
    reject: (reason?: any) => void
}
export const dvDefer = <T>(): DvDefer<T> => {
    let resolve!: ResolveFn<T>
    let reject!: RejectFn
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

/**
 * string 相关
 */
/**
 * 计算字符串长度，中文占 2 字符
 *      dvStrlen('abc:_|;,. $') = 11
 *      dvStrlen('abc: 中文，；') = 13
 */
export const dvStrlen = (str: string): number => {
    if (!str) return 0
    //按 码点 遍历，保证 emoji 等 代理对字符 不被拆成 2 个字符
    let len = 0
    for (const ch of str) {
        //!! 码点 > 0xff 的视为 宽字符（中文、全角标点等），占 2 字符
        len += (ch.codePointAt(0) ?? 0) > 0xff ? 2 : 1
    }
    return len
}
/**
 * dvTrimAny 系列 — 裁剪字符串两侧/单侧任意指定字符
 *      dvTrimAny('foobar', 'foo')          --> 'bar'
 *      dvTrimAnyStart('foobar', 'foo')     --> 'bar'
 *      dvTrimAnyEnd('foobar', 'foo')       --> 'foobar'
 */
export const dvTrimAny = (str: string, chars: string): string =>
    dvTrimAnyStart(dvTrimAnyEnd(str, chars), chars)
export const dvTrimAnyStart = (str: string, chars: string): string => {
    if (!str || !chars) return str
    const escaped = chars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return str.replace(new RegExp(`^[${escaped}]+`), '')
}
export const dvTrimAnyEnd = (str: string, chars: string): string => {
    if (!str || !chars) return str
    const escaped = chars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return str.replace(new RegExp(`[${escaped}]+$`), '')
}

//首字母大写
export const dvUcfirst = (str: string): string =>
    `${str.substring(0, 1).toUpperCase()}${str.substring(1).toLowerCase()}`
//CamelCase foo-bar --> FooBar
const dvCamelCase = (str: string, ucfirst: boolean = true): string => {
    //分隔符 -_/.
    str = str.replace(/[-_/.]/g, ' ')
    const stra = str.split(' ').map((s: string, i: number): string => {
        return i !== 0 || ucfirst ? dvUcfirst(s) : s.toLowerCase()
    })
    return stra.join('')
}
//KababCase FooBar --> foo-bar
const dvKababCase = (str: string, split: string = '-'): string => {
    const ms = str.matchAll(/[A-Z]{1}/g)
    const ma = [...ms]
    if (ma.length <= 0) return str
    let stra = []
    for (let i = 0; i < ma.length; i++) {
        if (!ma?.[i]) continue
        let s = ma[i]?.index,
            e = i >= ma.length - 1 ? 0 : ma[i + 1]?.index
        if (s === undefined) continue
        if (i === 0 && s > 0) stra.push(str.substring(0, s))
        stra.push(e === 0 ? str.substring(s) : str.substring(s, e))
    }
    return stra.join(split).toLowerCase()
}
//将任意类型字符串( fooBar foo-bar foo_bar foo.bar )，转为 FooBar|fooBar 形式
export const dvCamel = (str: string, ucfirst: boolean = true): string => {
    //foo-bar foo.bar foo_bar  --> FooBar|fooBar
    if (str.includes('-') || str.includes('_') || str.includes('.'))
        return dvCamelCase(str, ucfirst)
    //fooBar --> FooBar|fooBar
    str = dvKababCase(str, '-')
    return dvCamelCase(str, ucfirst)
}
//将任意类型字符串( fooBar FooBar )，转为 foo-bar
export const dvKabab = (str: string, split: string = '-'): string => {
    //foo-bar foo.bar foo_bar  --> foo-barr
    if (str.includes('-') || str.includes('_') || str.includes('.')) {
        str = str.replace(/[-_/.]/g, split)
        return str.toLowerCase()
    }
    return dvKababCase(str, split)
}

//比较 0.10.8 形式的 version 的先后关系
//0.10.9 晚于 0.8.11
//  dvVerCompare('0.10.9', '0.8.11') == 1       //前面的 晚于(>) 后面的
//  dvVerCompare('0.8.11', '0.10.9') == -1      //前面的 早于(<) 后面的
//  dvVerCompare('0.8.11', '0.08.011') == 0     //版本号相等
//!! 出错则返回 -9999
export const dvVerCompare = (ver1: string, ver2: string): number => {
    const varr1 = dvTrimAny(ver1.trim(), '.').split('.')
    const varr2 = dvTrimAny(ver2.trim(), '.').split('.')
    const vlen1 = varr1.length
    const vlen2 = varr2.length
    //版本号 . 长度
    const len = vlen1 <= vlen2 ? vlen2 : vlen1
    //所有版本号 补齐为相同长度(尾补) 8.10 --> 8.10.0.0
    if (len > vlen1) varr1.push(...Array(len - vlen1).fill('0'))
    if (len > vlen2) varr2.push(...Array(len - vlen2).fill('0'))
    //确保每一节都是 数字
    const ensureNum = (s?: string): number | undefined => {
        if (s === undefined || !dvIs.realNumber(s)) return undefined
        return parseInt(s)
    }
    //依次比较每一节
    for (let i = 0; i < len; i++) {
        const n1 = ensureNum(varr1?.[i])
        const n2 = ensureNum(varr2?.[i])
        if (n1 === undefined || n2 === undefined || isNaN(n1) || isNaN(n2)) return -9999
        if (n1 === n2) {
            continue
        } else {
            return n1 > n2 ? 1 : -1
        }
    }
    return 0
}

/**
 * array 相关
 */
//计算 传入数组的 交集
export const dvInter = (...arrs: any[][]): any[] => {
    if (arrs.length <= 1) return []
    let rtn: any[] = arrs[0] ?? []
    for (let i = 1; i < arrs.length; i++) {
        rtn = rtn.filter((j) => arrs[i]?.includes(j))
        if (rtn.length <= 0) return []
    }
    return rtn
}
//计算 传入数组的 差集
export const dvDiff = (...arrs: any[][]): any[] => {
    if (arrs.length <= 0) return []
    if (arrs.length === 1) {
        if (arrs[0] !== undefined) return arrs[0]
        return []
    }
    let rtn: any[] = arrs[0] ?? []
    for (let i = 1; i < arrs.length; i++) {
        rtn = rtn.filter((j) => !arrs[i]?.includes(j))
        if (rtn.length <= 0) return []
    }
    return rtn
}
//计算 传入数组的 并集
export const dvUnion = (...arrs: any[][]): any[] => {
    if (arrs.length <= 0) return []
    if (arrs.length === 1) {
        if (arrs[0] !== undefined) return arrs[0]
        return []
    }
    let rtn: any[] = arrs[0] ?? []
    for (let i = 1; i < arrs.length; i++) {
        if (!arrs[i] || !dvIs.array(arrs[i])) continue
        rtn.push(...(arrs[i] as any[]))
        //去重
        rtn = [...new Set(rtn)]
    }
    return rtn
}
//数组去重
export const dvUnique = (arr: any[]): any[] => {
    return [...new Set(arr)]
}

/**
 * date 相关
 */
//快速生成时间字符串，format 支持 YYYY-MM-DD HH:mm:ss 形式，ts 为毫秒|秒时间戳
export const dvDateStr = (format: string = 'YYYY-MM-DD HH:mm:ss', ts?: number): string => {
    const now = ts !== undefined ? new Date(ts > 9999999999 ? ts : ts * 1000) : new Date()
    const pad = (n: number) => String(n).padStart(2, '0')

    const map: Record<string, string> = {
        YYYY: String(now.getFullYear()),
        YY: String(now.getFullYear()).slice(-2),
        MM: pad(now.getMonth() + 1),
        M: String(now.getMonth() + 1),
        DD: pad(now.getDate()),
        D: String(now.getDate()),
        HH: pad(now.getHours()),
        H: String(now.getHours()),
        mm: pad(now.getMinutes()),
        m: String(now.getMinutes()),
        ss: pad(now.getSeconds()),
        s: String(now.getSeconds()),
    }

    //替换 format 中的占位符，未匹配的字符原样保留
    //!! 按长到短匹配，避免 YYYY 被 YY 优先误替换
    return format.replace(/YYYY|YY|MM|DD|HH|mm|ss|M|D|H|m|s/g, (key) => map[key] ?? key)
}
