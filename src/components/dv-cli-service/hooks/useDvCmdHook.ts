/**
 * Deskvue 组件 hook
 * 处理 DvCliService 服务组件中的 command-line
 *
 * 输出的字符串数据，解析为行输出结构：
 *  cell 形式：
 *      <{{tab}}>               tab 标记
 *      <{{tab x2}}>            连续 2 个 tab
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
 */

import { computed } from 'vue'
import { type DvProgramHookGetter } from '@/kernel'
import { dvIs, dvCssstr, dvStrlen } from '@utils/core'

//定义 命令行终端显示的 全局参数，cell 输出解析为 html 时需要这些参数
//!! 这些参数会在 DvCliService 服务启动时写入服务私有内存中，用户可以调整这些参数
export interface DvCmdTerminalConfig {
    //字符字号，默认 14px
    fsize: number
    //一个 tab 显示的字符数，默认 4
    tabw: number
}

//定义 命令行 一行输出中的基本 cell 单元的结构
export interface DvCmdOutputCell {
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
export interface DvCmdOutputRow {
    //在 buffer[] 中的序号
    idx: number
    //原始输出语句，字符串，带有特别的可被解析的字符
    origin: string
    //解析原始语句得到的 cells 有序单元集合，一行输出包含多个 cell 单元
    //此数组为空，表示这是一个空行
    cells: DvCmdOutputCell[]
    //根据 cells 解析得到的 最终显示的 html
    //显示的时候，依次解析各 row，如果没有 row.html 数据，则解析 cells，如果有 row.html 则直接显示
    html?: string
    //这个 OutputRow 被写入 CmdBuffer[] 的时间戳，毫秒
    //在 origin 输出语句解析之前
    timestamp: number
}
//定义 命令行 一行输入的结构，命令解析将基于此结构
export interface DvCmdInputRow {
    //在 buffer[] 中的序号
    idx: number
    //用户原始输入的语句
    origin: string
    //解析 origin 得到的 命令 和 参数
    command: string
    params?: PlainObject

    //命令解析得到的 最终将要实际调用的 方法 和 参数[]
    //!! 这些方法来自 命令行 方法注册表
    method?: string
    args?: any[]

    //这个 InputRow 被写入 CmdBuffer[] 的时间戳，毫秒
    //在 命令解析之前
    timestamp: number
}
//保存在 DvCliService 系统服务内存中的 当前会话的所有 命令行输入输出缓存
export type DvCmdBuffer = (DvCmdInputRow | DvCmdOutputRow)[]

//默认的终端显示参数
export const dvCmdTerminalConfig: DvCmdTerminalConfig = {
    fsize: 14,
    tabw: 4,
}

//cell 分割标记
const cellsep = ['<{{', '}}>'] as const
//cell 内容分割标记
const cntsep = '::'
//class 分割标记
const clssep = '.'
//style 分割标记
const stysep = ';'
//默认的 命令行显示 html 样式类前缀
const clspre = 'dv-buffer'

export const useDvCmdHook = (hookGetter: DvProgramHookGetter) => {
    //获取 内存中 命令行的显示参数，只读，修改需要在 terminal 组件内
    const terminal = computed<DvCmdTerminalConfig>(() => {
        const { memory } = hookGetter()
        return (memory.value?.buffer ?? []) as DvCmdTerminalConfig
    })

    //获取 当前会话中所有 命令行输入输出缓存，只读
    const buffer = computed<DvCmdBuffer>(() => {
        const { memory } = hookGetter()
        return (memory.value?.buffer ?? []) as DvCmdBuffer
    })

    //向 buffer 写入数据，用户写入则为 input ，服务响应写入则为 output
    const bufInput = async (origin: string): Promise<void> => {
        if (!origin || !dvIs.nemstr(origin)) return
        const idx = buffer.value.length
        const buf: Partial<DvCmdInputRow> = {
            idx,
            origin,
        }
        //TODO:
    }
    const bufOutput = async (origin: string): Promise<void> => {
        //TODO:
    }

    //input 解析

    //output 解析
    const parseCells = (origin: string): DvCmdOutputCell[] => {
        if (!origin || !dvIs.nemstr(origin)) return []
        const cells: DvCmdOutputCell[] = []
        //不带 cell 标记
        if (!origin.includes(cellsep[0])) {
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
        const oa: string[] = origin.split(cellsep[0])
        const ca: string[] = []
        for (let i = 0; i < oa.length; i++) {
            const oi = oa[i]
            if (!oi) continue
            if (oi.includes(cellsep[1])) {
                ca.push(...oi.split(cellsep[1]))
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
            let celli: DvCmdOutputCell = {
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
                //行首，或前一个 cell 不是 tab 写入
                if (cellidx <= 0 || (lcell && lcell.istab !== true)) {
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
                    }
                }
            }
            //普通 cell 不含 class | style
            else if (!cnt.includes(cntsep)) {
                celli.idx = cellidx
            }
            //普通 cell 含 class | style
            else {
                //分割 内容
                const ca = cnt.split(cntsep).map((i: string) => i.trim())
                if (ca.length >= 2 && ca[0] && ca[1]) {
                    celli.idx = cellidx
                    celli.content = ca.slice(1).join(cntsep)
                    //分割 class | style
                    const sa = ca[0].split(stysep).map((i: string) => i.trim())
                    const sty: string[] = []
                    for (let j = 0; j < sa.length; j++) {
                        const sj = sa[j]
                        if (!sj) continue
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
    const cellsToHtml = (cells: DvCmdOutputCell[]): string => {
        const { tabw } = terminal.value
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
            if (!dvIs.nemstr(cell.content) && !cell.istab) continue
            //class
            html.push(`<span class="${clspre}-cell`)
            if (dvIs.nemstr(cell.class)) {
                html.push(` ${cell.class}"`)
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
            //tabbed
            else if (cell.tabbed) {
                //内容字符串长度(字符数)
                const len = dvStrlen(cell.content)
                //必须是 tabw 的整数倍，不足的补空格
                const n = len % tabw === 0 ? 0 : tabw - (len % tabw)
                cnt = `${cell.content}${'&nbsp;'.repeat(n)}`
            }
            //普通
            else {
                //直接使用 cell.content
                cnt = cell.content
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

    //工具

    return {
        bufInput,
        bufOutput,
    }
}
