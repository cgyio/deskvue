/**
 * Deskvue 库 全局类型声明
 */

import type { DvKernelGlobal } from '@/kernel'
import DvOs from '@kernel/os/index.vue'

declare global {
    //定义全局变量
    var dvTriggerError: (
        err: Error,
        abort: boolean = false,
        returnValue?: any,
    ) => void | typeof returnValue
    var Vue: any
    var Deskvue: Record<string, any>
    var DvKernel: DvKernelGlobal
    var DvSysCall: (cmd: string, ...args: any[]) => any
    var DvApp: App<Element>
    var DvOS: InstanceType<typeof DvOs>
    var dvOs: () => InstanceType<typeof DvOs>

    //定义通用类型
    type PlainObject = Record<string, any>
    //UUID v7：版本位固定为 7，变体位固定为 [89ab]，其余位为任意十六进制占位
    type Uuid = `${string}-${string}-7${string}-${'8' | '9' | 'a' | 'b'}${string}-${string}`

    // ====================================================================
    //  通用类型工具：从 <Prefix><Name><Suffix> 中提取 camelCase 短名称
    //  通过 Prefix + Suffix 参数适配 Hook / Store / Service 等命名约定
    //  全局可用，无需 import
    // ====================================================================

    /**
     * "useDvFooBarHook"  (Prefix='useDv', Suffix='Hook')    → "fooBar"
     * "useDvFooBarStore" (Prefix='useDv', Suffix='Store')   → "fooBar"
     * "DvFooBarService"  (Prefix='Dv',    Suffix='Service') → "fooBar"
     */
    type ExtractShortName<
        K extends string,
        Suffix extends string,
        Prefix extends string = 'useDv',
    > = K extends `${Prefix}${infer Name}${Suffix}`
        ? Name extends `${infer F}${infer R}`
            ? `${Lowercase<F>}${R}`
            : Lowercase<Name>
        : K

    /**
     * 将注册表转为短名称 → 条目 的映射
     *   { useDvServiceHook, useDvWinContentHook } + 'Hook'
     *   → { service: typeof useDvServiceHook, winContent: typeof useDvWinContentHook }
     *
     *   { DvCmdService, DvWinService } + 'Service' + 'Dv'
     *   → { cmd: typeof DvCmdService, win: typeof DvWinService }
     */
    type BuildShortNameMap<
        T extends Record<string, any>,
        Suffix extends string,
        Prefix extends string = 'useDv',
    > = {
        [K in keyof T as ExtractShortName<K & string, Suffix, Prefix>]: T[K]
    }

    // WebUSB API — TypeScript 默认 DOM 类型中未包含
    interface USBDevice {
        open(): Promise<void>
        close(): Promise<void>
        selectConfiguration(configurationValue: number): Promise<void>
        claimInterface(interfaceNumber: number): Promise<void>
        transferOut(endpointNumber: number, data: Uint8Array): Promise<USBOutTransferResult>
        configuration: USBConfiguration
        readonly opened: boolean
        readonly productId: number
        readonly vendorId: number
        readonly productName?: string
        readonly serialNumber?: string
    }
    interface USBConfiguration {
        readonly configurationValue: number
        readonly interfaces: USBInterface[]
    }
    interface USBInterface {
        readonly interfaceNumber: number
        readonly alternate: USBAlternateInterface
    }
    interface USBAlternateInterface {
        readonly endpoints: USBEndpoint[]
    }
    interface USBEndpoint {
        readonly endpointNumber: number
        readonly direction: 'in' | 'out'
    }
    interface USBOutTransferResult {
        readonly status: 'ok' | 'stall' | 'babble'
        readonly bytesWritten: number
    }
    interface Navigator {
        readonly usb: {
            requestDevice(options: {
                filters: Array<{ vendorId?: number; productId?: number }>
            }): Promise<USBDevice>
            getDevices(): Promise<USBDevice[]>
        }
    }
}

/*declare module 'vue' {
  interface App {

  }
}*/

export {}
