/**
 * Deskvue 命令行系统 store
 * 此 store 不会持久化
 */

import { type App, ref, reactive, computed, toRef, watch } from 'vue'
import { defineStore } from 'pinia'

//定义命令行 换行符
export type DvLf = '\n' | '\r\n'
const dvLf: DvLf = '\n'
//定义命令行 tab
export type DvTab = '\t'
const dvTab = '\t'

//定义 terminal 中显示每一行命令行时，可以定义的样式结构
export interface DvCmdTerminalLineStyle {
    color?: string | Record<string, string>
    size?: string | number
    family?: string
    weight?: string | number
    tabWidth?: number
}
//默认的 terminal 行样式
export const dvCmdTerminalLineDefaultStyle: DvCmdTerminalLineStyle = {
    color: 'var(--el-text-color-regular)',
    size: 'var(--el-font-size-base)',
    family: "'Cascadia Code',Consolas, 'Courier New', monospace",
    weight: 'normal',
    tabWidth: 4,
}

//定义 输出内容到 console 时的 参数格式
export interface DvCmdConsolePushOption {
    style?: DvCmdTerminalLineStyle
    prompt?: string
    [K: string]: any
}

//定义 console 中 每一行的 数据结构类型
//!! 此数据会一直缓存，直到当前页面关闭
export interface DvCmdConsoleRow {
    //此行数据的类型，可选：output | input  表示这是 输出行 | 输入行
    io: 'output' | 'input'

    //此行内容字符串
    //!! output 输出行保存完整字符串，input 输入行则只保存用户输入的内容
    content: string

    //提示字符串，仅针对 input 输入行，输出行 = ''
    prompt: string

    //自动生成的数据
    //行号，在调用 dvCmd.output() 以及 dvCmd.waitInput() 时，自动生成行号
    index: number
    //实际在 terminal 中显示的完整行字符串，line = prompt+content
    line: string
    //此行字符串总长度，line.length
    length: number
    //输入完成标记，仅针对 input 输入行，用户键入回车后自动设为 true
    finish: boolean

    //此行在 terminal 中显示时的特殊样式
    style?: DvCmdTerminalLineStyle
}

//定义 terminal 终端中每一行数据的 格式类型
export interface DvCmdTerminalLine {
    //完整一行字符串
    text: string
    //实际显示的 html 包含了样式（全部转换为 内联样式）
    html: string
}

export const useDvCmdStore = defineStore(
    'dvCmd',
    () => {
        //console 缓存所有 command-line 数据
        const dvConsole = reactive<DvCmdConsoleRow[]>([])
        //terminal 终端显示的实际字符串内容
        const terminal = computed<DvCmdTerminalLine[]>((): DvCmdTerminalLine[] => {
            //TODO：
            return []
        })

        //向 console 输出内容，返回当前行的行号
        const push = (
            content: string,
            options?: DvCmdConsolePushOption,
            index?: number, //指定行号，可以改写某行数据
        ): number => {
            //TODO：
            //dvConsole.push() || dvConsole.splice()
            return 0
        }

        //输出行，返回行号
        const output = (content: string, options?: DvCmdConsolePushOption): number => {
            const ridx = push(content, options)
            if (dvConsole[ridx]) {
                const row = dvConsole[ridx]
                row.finish = true
            }
            return ridx
        }

        //等待用户输入
        const waitInput = (): void => {}

        //启动时
        const inited = ref<boolean>(false)
        const init = (): void => {
            if (inited.value) return
            //插入 固定的 命令行头部
            const clhd = `
        ┌──────────────────────────────────────────┐
        │         Deskvue Console Started !        │
        ├──────────────────────────────────────────┤
        │  Ctrl+Alt+G to Open terminal window      │
        │  type 'help' to get command description  │
        │  account-auth-check also enabled in cli  │
        └──────────────────────────────────────────┘
        `
            clhd.split(dvLf).forEach((l) => {
                output(l.trim())
            })
            waitInput()

            inited.value = true
        }

        //初始化 store
        const initStore = (app: App, options: Record<string, any> = {}): void => {}

        //自动更新接口返回 对应数据后，写入 store
        const updateStore = (updata: Record<string, any>): void => {}

        return {
            dvConsole,
            terminal,

            output,
            waitInput,

            init,

            initStore,
            updateStore,
        }
    },
    {
        persist: false,
    },
)

//!! 返回 store 类型
export type DvCmdStore = ReturnType<typeof useDvCmdStore>
