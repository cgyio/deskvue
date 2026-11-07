/**
 * Deskvue kernel
 * 定义 Deskvue 内核错误类型
 */

//kernel-error levels
export type DvKernelErrorLevel = 'PANIC' | 'OOPS' | 'WARN'

//构造参数
export interface DvKernelErrorOption {
    level?: DvKernelErrorLevel
    cause?: unknown
}

export class DvKernelError extends Error {
    level: DvKernelErrorLevel = 'WARN'

    constructor(message: string, options?: DvKernelErrorOption) {
        const cause = options?.cause ? options.cause : 'unknown'
        super(message, { cause })
        this.name = 'DvKernelError'
        this.level = options?.level ?? 'WARN'
        this.cause = cause
    }

    //设置内核错误级别 level
    //!! 如果指定 compare= true 则比较现有的 和 传入的 错误级别，使用更严重的 level
    setLevel(level: DvKernelErrorLevel, compare: boolean = false) {
        if (this.level === level) return

        const lvls = ['WARN', 'OOPS', 'PANIC']
        const oidx = lvls.indexOf(this.level)
        const idx = lvls.indexOf(level)
        if (idx < 0) return

        if (!compare || oidx < idx) {
            this.level = level
        }
    }

    //为内核错误增加自定义 handle 方法
    handle() {
        const lvl = this.level
        //globalThis.DvKernel
        const stage = globalThis.DvKernel?.stage ?? undefined

        //在系统就绪后，产生的内核错误(非 PANIC)，弹窗提示
        if (stage && stage.stageAfter('os-ready', true) && lvl !== 'PANIC') {
            //OOPS 错误，可能需要 restart
            if (lvl === 'OOPS') {
                //TODO: 弹出确认框，由用户决定是否 restart
            }
            //默认 WARN 警告
            //!! dvTriggerError 内部会自动调用窗口服务弹出错误提示
            //!! 此处不需要处理
            return
        }

        //系统未就绪，产生的任何级别的内核错误，一律崩溃
        //内核崩溃，直接输出内容到 document
        return this.panic()
    }

    //内核错误，崩溃
    panic() {
        const gdk = globalThis.DvKernel
        if (!gdk) {
            const doc = globalThis.document
            if (!doc) return
            doc.open()
            doc.write(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>Deskvue Kernel Panic</title>
<style>
*{box-sizing:border-box;margin:0;padding:16px}
body{background:#111;color:#ff6b6b;padding:32px;font-family:monospace}
pre{white-space:pre-wrap;}
</style>
</head>
<body>
<pre>
Dsekvue Kernel Panic 内核已崩溃
可能的原因：${this.message}
</pre>
</body>
</html>
            `)
            doc.close()
            throw 'Deskvue Kernel Panic !!'
        }

        //prints
        gdk.prints.value.push('')
        gdk.prints.value.push(`[.dv-kernel-error]Dsekvue Kernel Panic 内核已崩溃`)
        gdk.prints.value.push(`[.dv-kernel-error]可能的原因：${this.message}`)
        throw 'Deskvue Kernel Panic !!'
    }
}

//抛出 内核错误
export const dvTriggerKernelError = (e: any, level: DvKernelErrorLevel = 'WARN'): any => {
    //创建内核错误
    let ke: DvKernelError
    //globalThis.DvKernel
    const gdk = globalThis.DvKernel ?? undefined

    //已传入 内核错误实例
    if (e instanceof DvKernelError) {
        ke = e
        //!! 使用更严重的 级别
        ke.setLevel(level, true)
    }

    //DvBusinessError | DvHttpError | Error
    else if (e instanceof Error) {
        ke = new DvKernelError(`发生内核错误，可能的原因：${e.message}`, { level, cause: e })
    }

    //未知原因
    else {
        const cause = typeof e === 'string' ? e : 'unknown'
        ke = new DvKernelError(`发生内核错误，可能的原因：${cause}`, { level, cause })
    }

    if (ke instanceof DvKernelError) {
        //错误保存到 gdk.errors
        gdk.errors.push(ke)
        //触发全局错误
        return dvTriggerError(
            ke,
            //根据 ke 的 level 决定是否 panic，不 panic 则不会终止后续
            false,
            //如果不终止，则将 ke 内核错误实例 返回给外部调用者，外部可能有其他处理逻辑
            ke,
        )
    }
}
