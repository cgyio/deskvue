/**
 * Deskvue kernel
 * 由 DvCliService 内核服务使用的 输入输出缓冲区 ioBuffer 操作工具
 *
 * !! ioBuffer 输入输出缓冲区实际内容保存在 内存树 /sys/buffer 节点，reg+ext 类型，*.buffer
 * !! 任意程序组件内部可以读取缓冲区内容，computed 只读
 *
 * !! 只有 引用了此 hook 的 内核服务 或 系统程序 可以写入 ioBuffer 缓冲区
 *
 *
 * 输出的字符串数据，解析为行输出结构：
 *  cell 形式：
 *      <{{tab}}>               tab 标记
 *      <{{tab x2}}>            连续 2 个 tab
 *      <{{nbsp}}>              一个空格
 *      <{{nbsp x3}}>           连续 3 个空格
 *      <{{.foo::[time]}}>              YYYY-MM-DD HH:mm:ss 格式时间戳
 *      <{{.foo::[time HH:mm:ss]}}>     HH:mm:ss 格式
 *      <{{.foo.bar::输出的文字内容 foobar $%^&*}}>
 *          带 class 的 cell
 *      <{{ .foo.bar; opacity: 0.5; box-sizing: border-box; :: 输出内容 $%^&* }}>
 *          带 class 和 style 的 cell
 *      输出内容 $%^&*
 *          什么都不带的 cell，相当于 <{{输出内容 $%^&*}}>
 *      <{{}}>                  空 cell 跳过
 *  row 整行：
 *      输出内容，<{{tab}}>另一段输出<{{.foo::有样式的输出}}><{{tab x2}}><{{tab}}>
 *          共计 5 个 cell
 *              输出内容，                  tabbed
 *              tab                       tablength = 1
 *              另一段输出
 *              有样式的输出                tabbed, class = foo
 *              tab                       tablength = 3
 *
 *
 */

import { computed } from 'vue'
import { type DvProgramHookGetter } from './useDvProgram'
import { dvConfig } from '../../config'
import { dvIs, dvWait, dvExtend, dvStrlen, dvEscapeHtml, dvDateStr } from '@utils/core'
import { type DvInodeHandler, useDvMemStore } from '../../fs'
import { DvKernelError } from '../../error'

//定义 命令行终端显示的 全局参数，cell 输出解析为 html 时需要这些参数
//!! 默认参数保存在 /sys/config 节点数据 inode._icache_.content.service.cli 项下
export interface DvIoBufferConfig {
    //输入输出字符样式 parser 参数
    parser: {
        //cell 分割标记，默认 ['<{{', '}}>']
        cellsep: string[]
        //cell 内容分割标记，默认 '::'
        cntsep: string
        //class 分割标记，默认 '.'
        clssep: string
        //style 分割标记，默认 ';'
        stysep: string
        //默认的 命令行显示 html 样式类前缀，默认 'dv-buffer'
        clspre: string
    }
    //buffer 缓冲区最大容量，默认 256
    maxRow: number
    //字符字号，默认 14px
    fsize: number
    //一个 tab 显示的字符数，默认 4
    tabw: number
}

//定义 命令行 一行输出中的基本 cell 单元的结构
export interface DvIoBufferCell {
    //在 cells 数组中的 idx 序号
    idx: number
    //字符内容
    content: string
    //此 cell 的后面是否跟着 tab 标记
    //如果此 cell 后面跟着 tab 标记，则此 cell 最终显示宽度将贴紧网格
    tabbed: boolean
    //此 cell 本身是否是一个 tab
    //tab 单元没有内容，仅显示固定宽度，默认 1 个 tab 显示 4 字符长度
    istab: boolean
    //如果是多个连续的 tab 将被合并到 tablength，用于实际显示宽度的计算
    tablength: number

    //此 cell 单元的显示样式，class | style
    //!! 常用样式都已定义 class，不是必须的话，不要使用 style
    class: string
    style: string
}
//定义 命令行 一行输出的结构，命令行界面根据此结构，生成最终的显示 html
export interface DvIoOutputRow {
    //在 buffer[] 中的序号
    //idx: number
    //原始输出语句，字符串，带有特别的可被解析的字符
    origin: string
    //解析原始语句得到的 cells 有序单元集合，一行输出包含多个 cell 单元
    //此数组为空，表示这是一个空行
    cells: DvIoBufferCell[]
    //根据 cells 解析得到的 最终显示的 html
    //显示的时候，依次解析各 row，如果没有 row.html 数据，则解析 cells，如果有 row.html 则直接显示
    html?: string
    //print 输出时的 额外参数，html 内容就是基于此参数生成的
    options?: DvIoPrintOptions
    //这个 OutputRow 被写入 CmdBuffer[] 的时间戳，毫秒
    //在 origin 输出语句解析之前
    timestamp: number
}
//定义 命令行 一行输入的结构，命令解析将基于此结构
export interface DvIoInputRow {
    //在 buffer[] 中的序号
    //idx: number
    //用户原始输入的语句
    origin: string
    //解析 origin 得到的 命令 和 参数
    command: string
    params?: PlainObject

    //命令解析得到的 最终将要实际调用的 方法 和 参数[]
    //!! 这些方法来自 命令行 方法注册表
    method?: string
    args?: any[]

    //显示
    //解析原始语句得到的 cells 有序单元集合，一行输出包含多个 cell 单元
    //此数组为空，表示这是一个空行
    cells: DvIoBufferCell[]
    //根据 cells 解析得到的 最终显示的 html
    //显示的时候，依次解析各 row，如果没有 row.html 数据，则解析 cells，如果有 row.html 则直接显示
    html?: string
    //print 输出时的 额外参数，html 内容就是基于此参数生成的
    options?: DvIoPrintOptions

    //这个 InputRow 被写入 CmdBuffer[] 的时间戳，毫秒
    //在 命令解析之前
    timestamp: number
}
//保存在 DvCliService 系统服务内存中的 当前会话的所有 命令行输入输出缓存
export type DvIoBuffer = (DvIoInputRow | DvIoOutputRow)[]

//向缓冲区输出内容时的参数结构
export interface DvIoPrintOptions {
    //是否内核输出
    isKernel?: boolean
    //是否在行尾添加时间戳
    appendTs?: boolean
    [K: string]: any
}

//用户输入命令时的额外参数
export interface DvIoInputOptions {
    [K: string]: any
}

export const useDvIoBuffer = <M extends PlainObject = PlainObject>(
    hookGetter: DvProgramHookGetter<M>,
) => {
    //!! 引用此 hook 的 内核服务 或 系统程序，拥有写入 ioBuffer 缓冲区的权限
    //!! 需要从 sysConfig 系统参数中读取对应的 service.cli 参数
    const ioConfig = computed<DvIoBufferConfig>(() => {
        return (
            hookGetter().sysConfig.value?.service?.cli ?? (dvConfig.service.cli as DvIoBufferConfig)
        )
    })

    //获取 /sys/buffer 节点句柄实例，并执行回调（一定是异步回调）
    const useBuffer = async (
        callback: (handler: DvInodeHandler<'DvExtRegInode'>) => Promise<any>,
    ): Promise<any> => {
        const hook = hookGetter()
        const hdl = await hook.sysCall('fs:open', '/sys/buffer')
        if (!hdl) return
        const rtn = await callback(hdl)
        await hook.sysCall('fs:close', hdl)
        return rtn
    }

    //读取当前 缓冲区内容
    const readBuffer = async (): Promise<DvIoBuffer> => {
        return await useBuffer(
            async (handler: DvInodeHandler<'DvExtRegInode'>): Promise<DvIoBuffer> => {
                //插入新行
                return await handler.read({}, hookGetter().callCtx.value)
            },
        )
    }

    //解析用户输入命令后，向缓冲区输出内容
    //!! 此方法应由 命令行解释器 调用
    const input = async (origin: string, opts?: DvIoInputOptions): Promise<void> => {
        if (!origin || !dvIs.nemstr(origin)) return
        //TODO:
    }

    //任意引用此 hook 的 内核服务 或 系统程序，向 ioBuffer 输出内容
    const print = async (origin: string, opts?: DvIoPrintOptions): Promise<void> => {
        //应用 print 参数
        const _origin = _fixOrigin(origin, opts)
        //解析 origin
        const cells: DvIoBufferCell[] = parseCells(_origin)
        if (cells.length <= 0) return
        const html = cellsToHtml(cells)
        const row: DvIoOutputRow = {
            origin,
            cells,
            html,
            options: opts ?? {},
            timestamp: Date.now(),
        }

        //!! 向缓冲区输出
        const callCtx = hookGetter().callCtx.value
        return await useBuffer(async (handler: DvInodeHandler<'DvExtRegInode'>): Promise<void> => {
            //插入新行
            await handler.write(row, {}, callCtx)
            //按最大行数截断
            await handler.truncate(ioConfig.value.maxRow, callCtx)
        })
    }
    //向最后一行中，追加输出
    const printExtend = async (origin: string, opts?: DvIoPrintOptions): Promise<void> => {
        const _buffer = await readBuffer()
        if (_buffer.length <= 0) return await print(origin, opts)
        if (!origin || !dvIs.nemstr(origin)) return

        const idx = _buffer.length - 1
        const lastRow = _buffer[idx] as DvIoOutputRow
        if (!lastRow || !lastRow.origin) return
        //追加 origin 原始字符
        origin = lastRow.origin + origin
        //原来的 print 额外参数
        opts = dvExtend<DvIoPrintOptions>(false, lastRow.options ?? {}, opts ?? {})

        //应用 print 参数
        const _origin = _fixOrigin(origin, opts)
        const cells: DvIoBufferCell[] = parseCells(_origin)
        if (cells.length <= 0) return
        const html = cellsToHtml(cells)

        //修改最后一行的 数据
        const newLastRow = {
            origin,
            cells,
            html,
            options: opts ?? {},
            timestamp: Date.now(),
        } as DvIoOutputRow

        const callCtx = hookGetter().callCtx.value
        return await useBuffer(async (handler: DvInodeHandler<'DvExtRegInode'>): Promise<void> => {
            //追加
            await handler.write(newLastRow, { extend: true }, callCtx)
        })
    }
    //根据 DvIoPrintOptions 参数，修改 origin 字符串
    const _fixOrigin = (origin: string, opts?: DvIoPrintOptions): string => {
        //解析 print 参数
        //内核输出，添加默认的 标记
        if (opts?.isKernel === true) origin = `<{{.teal::[~]}}><{{tab}}>${origin}`
        //行尾添加时间戳
        if (opts?.appendTs === true) origin = `${origin}<{{.at-tail::[time]}}>`
        return origin
    }

    //将要输出的原始 origin 字符串，解析为 cells[]
    const parseCells = (origin: string): DvIoBufferCell[] => {
        //if (typeof origin !== 'string') return []
        const cellsep = ioConfig.value.parser.cellsep ?? ['<{{', '}}>']
        const cntsep = ioConfig.value.parser.cntsep ?? '::'
        const clssep = ioConfig.value.parser.clssep ?? '.'
        const stysep = ioConfig.value.parser.stysep ?? ';'

        const cells: DvIoBufferCell[] = []
        //不带 cell 标记
        if (!origin.includes(cellsep[0] ?? '<{{')) {
            cells.push({
                idx: 0,
                content: origin,
                tabbed: false,
                istab: false,
                tablength: 0,
                class: '',
                style: '',
            })
            return cells
        }
        //分割 cell
        const oa: string[] = origin.split(cellsep[0] ?? '<{{')
        const ca: string[] = []
        for (let i = 0; i < oa.length; i++) {
            const oi = oa[i]
            if (oi === undefined) continue
            if (oi.includes(cellsep[1] ?? '}}>')) {
                ca.push(...oi?.split(cellsep[1] ?? '}}>'))
            } else {
                ca.push(oi)
            }
        }
        //依次解析
        let cellidx = 0
        for (let i = 0; i < ca.length; i++) {
            const ci = ca[i]
            if (!ci) continue
            const cnt = ci.trim()
            //当前 cell
            let celli: DvIoBufferCell = {
                idx: -1,
                content: cnt,
                tabbed: false,
                istab: false,
                tablength: 0,
                class: '',
                style: '',
            }
            //前一个 cell
            const lcell = cells?.[cellidx - 1]
            //tab
            if (cnt.startsWith('tab')) {
                //tab 宽度
                const tw = cnt.includes('tab x') ? parseInt(cnt.slice(5)) : 1
                //行首 直接 写入
                if (cellidx <= 0 /* || (lcell && lcell.istab !== true)*/) {
                    celli.idx = cellidx
                    celli.content = ''
                    celli.istab = true
                    celli.tablength = tw
                }
                //不是行首时，需要修改前一个 cell
                if (cellidx > 0 && lcell) {
                    if (lcell.istab === true) {
                        lcell.tablength += tw
                    } else {
                        lcell.tabbed = true
                        lcell.tablength += tw
                    }
                }
            }
            //nbsp 空格
            else if (cnt.startsWith('nbsp')) {
                //空格数
                const nw = cnt.startsWith('nbsp x') ? parseInt(cnt.slice(6)) : 1
                celli.idx = cellidx
                celli.content = ' '.repeat(nw)
            }
            //普通 cell 不含 class | style
            else if (!cnt.includes(cntsep)) {
                celli.idx = cellidx
            }
            //普通 cell 含 class | style
            else {
                //分割 内容
                const ca = cnt.split(cntsep).map((i: string) => i.trim())
                if (ca.length >= 2 && ca[0] && ca[1] !== undefined) {
                    celli.idx = cellidx
                    celli.content = ca.slice(1).join(cntsep)
                    //分割 class | style
                    const sa = ca[0].split(stysep).map((i: string) => i.trim())
                    const sty: string[] = []
                    for (let j = 0; j < sa.length; j++) {
                        const sj = sa[j]
                        if (sj === undefined) continue
                        //提取 class
                        if (j === 0 && sj.startsWith(clssep)) {
                            celli.class = sj.slice(1).split(clssep).join(' ')
                        }
                        //提取 style
                        else if (sj.includes(':')) {
                            sty.push(sj)
                        }
                    }
                    if (dvIs.nemarr(sty)) {
                        celli.style = sty.join('; ')
                    }
                }
            }

            //celli.idx >= 0 表示需要写入 cells
            if (celli.idx >= 0) {
                cells.push(celli)
                cellidx++
            }
        }

        return cells
    }
    //将 cells[] 解析为最终输出的 html
    const cellsToHtml = (cells: DvIoBufferCell[]): string => {
        const { tabw } = ioConfig.value
        const clspre = ioConfig.value.parser.clspre ?? 'dv-buffer'
        const html: string[] = [`<div class="${clspre}-row"`]
        //!! cells 为空，输出空行
        if (cells.length <= 0) {
            html.push('></div>')
            return html.join('')
        }
        html.push('>')
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i]
            if (!cell) continue
            //!! 跳过 空 cell
            if (cell.content === '' && !cell.istab) continue
            //class
            html.push(`<span class="${clspre}-cell`)
            if (cell.istab) html.push(' is-tab')
            if (dvIs.nemstr(cell.class)) {
                html.push(` ${cell.class}"`)
            } else {
                html.push('"')
            }
            //style
            if (dvIs.nemstr(cell.style)) {
                html.push(` style="${cell.style}"`)
            }
            html.push('>')
            //内容
            let cnt: string
            //istab
            if (cell.istab) {
                let tl = cell.tablength ?? 1
                //!! 如果 tab 不在行首，tl - 1
                if (cell.idx > 0) tl -= 1
                let n = tl * tabw
                if (n < 0) n = 0
                //使用空格补齐 tab 宽度
                cnt = '&nbsp;'.repeat(n)
            }
            //处理内容
            else {
                //处理内容中可能存在的 [...] 特殊标记
                cnt = _fixCellCnt(cell.content)
                //tabbed
                if (cell.tabbed) {
                    //内容字符串长度(字符数)
                    const len = dvStrlen(cnt)
                    //!! 字符长度补足到 tablength * tabw
                    const ton = cell.tablength * tabw
                    const n = len >= ton ? 0 : ton - len
                    //必须是 tabw 的整数倍，不足的补空格
                    //const n = len % tabw === 0 ? 0 : tabw - (len % tabw)
                    cnt = `${_escapeHtml(cnt)}${'&nbsp;'.repeat(n)}`
                }
                //普通
                else {
                    //直接使用 cell.content
                    cnt = _escapeHtml(cnt)
                }
            }
            html.push(`${cnt}`)
            //闭合 cell
            html.push('</span>')
        }
        //闭合 row
        html.push('</div>')
        //返回 html
        return html.join('')
    }
    //专门处理 cell.content 解析特殊标记 [***]，生成最终实际显示的 内容字符
    const _fixCellCnt = (content: string): string => {
        //[time]
        if (content.includes('[time]')) {
            const reg = new RegExp('\\[time\\]', 'g')
            const ts = dvDateStr()
            content = content.replace(reg, ts)
        }

        return content
    }
    //escapeHtml
    const _escapeHtml = (content: string): string => {
        //内容长度
        const len = dvStrlen(content)
        //内容是否是 1 个或多个 空格
        const issp = content.trim() === ''
        return issp ? '&nbsp;'.repeat(len) : dvEscapeHtml(content)
    }

    return {
        ioConfig,

        input,
        print,
        printExtend,
    }
}
