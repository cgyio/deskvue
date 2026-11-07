/**
 * Deskvue kernel
 * 基于 pinia 模拟 Linux 系统中的 磁盘行为
 *
 * 内存文件树，持久化保存的行为：
 *  0   针对 /sys 路径下的系统文件，只有下列文件会被持久化保存：
 *      dvHdd.fs.[/sys/config]      原始的系统参数 *.conf
 *          这些是原始的系统设置，只有在执行 update 更新操作后可能会被修改
 *      dvHdd.fs.[/sys/update]      系统更新数据 *.upd
 *          每次启动后，会自动从后台拉取 hash 检查更新
 *          如果需要，拉取更新数据，保存到这里，同时合并修改 dvHdd.fs.[/sys/config] 文件内容
 *              用户自定义的设置，也会在此时被同步合并处理
 *      dvHdd.fs.[/mnt/db_foo]      数据库 mnt+db 类型，保存数据库 schema
 *      dvHdd.fs.[/mnt/db_foo/bar]  数据模型 reg+model 类型，保存数据模型 schema
 *          数据库和数据模型的 schema 与用户无关，且不需要每次都从后台拉取，因此可以被持久化
 *          数据库 schema 中会保存时间戳，每次启动后比对时间戳，expire 后重新拉取
 *              拉取后，同时修改这些文件内容
 *              用户针对数据库、数据模型的个性化配置，也会在拉去后同步合并处理
 *      !! 其他系统文件会在启动时自动创建，只存在于内存树中，不会被持久化到 dvHdd
 *
 * 1    用户登录后，用户文件的持久化行为：
 *      dvHdd.fs.[iso:uuid]                     保存当前登录用户的所有数据
 *      dvHdd.fs.[iso:uuid].user                完整保存内存树中的 /user 目录
 *          目录结构完全一致，例如：
 *          dvHdd.fs.[iso:uuid].user.share  -->  dvMem.fs.user.share
 *          inode 节点数据结构 DvFsHddStruct，与内存数据结构 DvFsMemStruct 细微区别：
 *              inode._icache_ 不会持久化
 *              inode._content_ 只存在于 dvHdd 中，根据文件类型不同，保存不同的内容数据
 *                  reg 不指定 mime 和 后缀名的，保存纯文本内容
 *                  reg+mime 保存指向的实际文件 url，mime 文件只能保存在云端或本机文件中
 *                  reg+ext 是 Deskvue 系统的自有文件类型，以 json 对象形式保存在 _content_
 *
 *      dvHdd.fs.[iso:uuid].[/sys/config]       保存用户个性化的 系统设置
 *      dvHdd.fs.[iso:uuid].[/mnt/db_foo]       保存用户个性化的数据库 schema
 *      dvHdd.fs.[iso:uuid].[/mnt/db_foo/bar]   保存用户个性化的数据模型 schema
 *
 *      dvHdd.fs.[iso:uuid].program             保存用户自行安装的外部 program 程序组件
 *          inode._content_ = {
 *              component: 异步 Vue 组件的 *.vue 文件 url
 *              define?: 会缓存 Vue 组件的定义结构
 *          }
 *
 * dvHdd 磁盘中 文件节点的 _content_ 保存数据结构：
 * !! 根据 mode+type 决定 _content_ 里保存什么数据
 *      reg             普通文件，纯文本内容
 *      reg+ext         带后缀名的普通文件（不是 mime 类型），内容是 json 对象
 *          这类文件以 字符|json对象 形式直接保存在 _content_ 中
 *          运行时由处理程序读取，程序内部 文件内容 缓存在哪里由程序决定
 *          !! 但是如果要修改文件内容，程序在保存之前一定要将修改后的文件内容放到：
 *          !!      此文件的 内存映射节点的 inode._icache_.content 中
 *          !!      后续刷盘时，将根据 _icache_.content 中的内容来修改磁盘中的 _content_
 *
 *      reg+mime        拥有 mime 类型的真实文件，内容可能是大二进制
 *          这类文件通常保存在 云端 | 本地电脑文件系统 | OPFS 等位置
 *          在磁盘节点的 _content_ 中保存的是对应的 url 或 OPFS 路径 字符串
 *          运行时由处理程序读取这里的 url 或 路径字符串，然后读取实际内容，缓存在程序内部，通常
 *          缓存在 程序私有内存中，如果程序需要修改文件内容，通常是：
 *          !!      程序内部 sysCall('fs:save', ipath, 二进制内容)
 *          !!      此文件句柄实例内部不再是写 dvHdd，而是调用对应接口，将文件内容上传至云端，或写回 OPFS
 *          !!      dvHdd 中此文件节点的 _content_ 不会改变
 *
 *      mnt+db, reg+model   数据库|数据模型 schema 数据，内容是 json 对象
 *          这类文件以 json对象 形式直接保存在 对应的 ipath 完整路径键名下，不是普通的 DvFsHddStruct 结构
 *          程序读取 schema 数据时，走专用的 getDbSchema 通道，
 *          程序修改 schema 数据时，单独保存在 用户 usign 键名下
 *
 *      /sys/config     系统设置数据，reg+ext 类型
 *      /sys/update     系统更新数据，reg+ext 类型
 *          这类文件以 json对象 形式直接保存在 _content_ 中
 *          程序读取时走专门的 sysConfig 通道
 *          程序修改时，修改后的数据单独保存在 用户 usign 键名下
 *
 *      /program/*      仅在用户自行安装外部程序时，会涉及 dvHdd 写入，结构自动生成
 *          用户如果卸载这些程序，则会自动清理 dvHdd，不需要手动处理
 *          在内核启动时，这些程序会作为普通的 program 节点挂载到 内存树 dvMem.fs.program 下
 *          与内置程序有相同的行为
 *
 *      lnk             符号链接
 *          这类文件的 _content_ 中只保存 连接到的 其他节点的 ipath
 *          文件句柄的所有相应方法，只通过 ipath 透传到目标节点上
 *
 *      chr+driver      自定义驱动
 *          这类文件需要被持久化到用户 usign 键名下 dvHdd.fs.[iso:uuid].[/dev/my_driver]
 *          本质上，这类文件是为了实现一组关联的功能而定义的一套输入输出协议：
 *              handler = sysCall('fs:open', '/dev/my_driver')
 *              handler.ioctl('method', ...args)
 *          _content_ = {
 *              driver: 'url/to/some_driver.ts',
 *              methods: {
 *                  ...方法注册表
 *              }
 *          }
 *
 *      /dev /run 这些都是运行时数据，不涉及持久化
 *
 *
 *
 */

import { ref, reactive, readonly, computed } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import {
    type DvFsHddStruct,
    type DvFsInodeHddStruct,
    type DvFsInodeMemStruct,
    type DvFsMemStruct,
    dvFsEmptyInodeTime,
} from '../types'
import { useDvFsIpath } from '../utils'
import { useDvMemStore } from './dv-mem'
import { dvIs, dvExtend, dvCopy, dvLoget, dvTrimAny } from '@utils/core'

//ipath 工具
const ipu = useDvFsIpath()
//获取 uSign
const uSign = (): string | undefined => useDvMemStore().addrSession()?._icache_?.uSign

export const useDvHddStore = defineStore(
    'dvHdd',
    () => {
        //模拟 Linux 系统的 FS 文件系统行为
        //!! 持久化的(保存到磁盘的)文件系统
        const fs = reactive<Record<string, DvFsHddStruct>>({
            //!! 系统设置，全局基础设置
            '/sys/config': {
                _ipath_: '/sys/config',
                _inode_: {
                    mode: 'reg',
                    auth: 101,
                    owner: 'root',
                    time: { ...dvFsEmptyInodeTime },
                    name: 'config',
                    extra: {
                        type: 'ext',
                        mime: '*.conf',
                    },
                },
                _content_: {
                    //!! 此处保存 Deskvue 系统的全局设置
                    version: '0.0.1',
                    service: {
                        cli: {
                            fsize: 14,
                            tabw: 4,
                        },
                        gui: {
                            dvLogo: 'https://ms.systech.work/src/icon/deskvue-logo${expand}${dark}.svg',
                            wallpaper: 'https://qypms.systech.work/wallpaper/dvwp_${dark}.webp',
                            //defaultWallpapers: '',
                            desktopGridSize: 'medium',
                            desktopGridGutter: 16,
                            desktopPadding: 16,
                            taskbarPosition: 'bottom',
                            taskbarSize: 64,
                        },
                        win: {
                            windowTightness: 'compact',
                        },
                    },
                },
            },

            //!! 系统更新
            '/sys/update': {
                _ipath_: '/sys/update',
                _inode_: {
                    mode: 'reg',
                    auth: 101,
                    owner: 'root',
                    time: { ...dvFsEmptyInodeTime },
                    name: 'config',
                    extra: {
                        type: 'ext',
                        mime: '*.upd',
                    },
                },
                _content_: {
                    //!! 后台拉取的更新包数据
                    update: {
                        _hash_: '',
                        //...
                    },
                    //!! 后台拉取的远程配置，用于 远程启停功能，灰度测试 等
                    remote: {
                        _hash_: '',
                        //...
                    },
                },
            },

            //!! 登录用户
            //'iso:uuid': {
            //    '/sys/config': {},
            //    '/mnt/db_foo': {},
            //    user: {}
            //}
        })
        //只读
        //const _fs = readonly(fs)

        //磁盘寻址，返回的是 响应式数据
        const addr = (ipath: string): DvFsHddStruct | undefined => {
            ipath = ipu.norm(ipath)

            //!! 用户登录后优先从用户目录下查找
            const usign = uSign()
            if (usign && fs?.[usign] && dvIs.nemobj(fs[usign])) {
                //先直接匹配
                if (fs[usign][ipath]) return fs[usign][ipath]
                //再 loget
                const rtn = dvLoget(fs[usign], dvTrimAny(ipath, '/'))
                if (rtn) return rtn
            }

            //!! 用户路径下不存在，再从顶层查找
            //首先尝试直接键名
            if (fs[ipath]) return fs[ipath]
            //再尝试 loget
            return dvLoget(fs, dvTrimAny(ipath, '/'))
        }

        //数据结构转换 DvFsHddStruct -->  DvFsMemStruct
        const toMemStruct = (inode: DvFsHddStruct): DvFsMemStruct | undefined => {
            //!! _content_ 必须
            if (!inode._content_) return undefined
            //登录态
            const usign = uSign()
            const mode = inode._inode_.mode
            const type = inode._inode_.extra?.type ?? ''
            const itp = `${mode}${type === '' ? '' : '+' + type}`

            //特殊类型
            //用户自行安装的 program
            if (itp === 'reg+program') {
                if (!usign) return undefined
                const cnt = inode._content_ as PlainObject
                if (!dvIs.nemobj(cnt)) return undefined
                const def = cnt?.define
                const pn = def && def.programMeta ? def.programMeta.name : ipu.last(inode._ipath_)
                const mem: DvFsMemStruct = {
                    _ipath_: `/program/${pn}`,
                    //!! 以 {} 作为 target，避免把运行时标记写进磁盘节点的 _inode_
                    _inode_: dvExtend<DvFsInodeMemStruct>(false, {}, inode._inode_, {
                        owner: usign,
                        extra: {
                            type: 'program',
                            component: pn,
                        },
                        //运行时标记
                        modi: 0,
                        lock: 0,
                        open: [],
                    }),
                    //添加 icache
                    _icache_: {
                        handler: null,
                        remoteComponent: cnt.component,
                    },
                }
                if (def) mem._icache_.meta = dvCopy(def.programMeta)
                return mem
            }

            //mime 类型
            else if (itp === 'reg+mime') {
                //此类型文件在 dvHdd 中只保存 url 引用，不保存实际内容
                //映射到内存树的时候，在 _icache_.content 中写入这些 引用
                return {
                    _ipath_: inode._ipath_,
                    //!! 以 {} 作为 target，避免把运行时标记写进磁盘节点的 _inode_
                    _inode_: dvExtend<DvFsInodeMemStruct>({}, inode._inode_, {
                        //运行时标记
                        modi: 0,
                        lock: 0,
                        open: [],
                    }),
                    //添加 icache
                    _icache_: {
                        handler: null,
                        content:
                            typeof inode._content_ === 'string'
                                ? inode._content_
                                : dvCopy(inode._content_),
                    },
                }
            }

            //系统文件 /sys 路径下的
            else if (inode._ipath_.startsWith('/sys/')) {
                return {
                    _ipath_: inode._ipath_,
                    //!! 以 {} 作为 target，避免把 auth/owner/运行时标记写进磁盘节点的 _inode_
                    _inode_: dvExtend<DvFsInodeMemStruct>({}, inode._inode_, {
                        auth: 101,
                        owner: 'root',
                        //运行时标记
                        modi: 0,
                        lock: 0,
                        open: [],
                    }),
                    //添加 icache
                    _icache_: {
                        handler: null,
                    },
                }
            }

            //...更多其他类型文件节点转换

            //通用转换方法
            else {
                return {
                    _ipath_: inode._ipath_,
                    //!! 以 {} 作为 target，避免把运行时标记写进磁盘节点的 _inode_
                    _inode_: dvExtend<DvFsInodeMemStruct>({}, inode._inode_, {
                        //运行时标记
                        modi: 0,
                        lock: 0,
                        open: [],
                    }),
                    //添加 icache
                    _icache_: {
                        handler: null,
                    },
                }
            }
        }
        const toHddStruct = (inode: DvFsMemStruct): DvFsHddStruct | undefined => {
            //生成持久化结构
            const hdd: PlainObject = {
                _ipath_: inode._ipath_,
                //!! 以 {} 作为 target，避免 __delete__ 标记删到内存节点的运行时字段
                _inode_: dvExtend<DvFsInodeHddStruct>({}, inode._inode_, {
                    //使用 dvExtend 的 __delete__ 标记
                    modi: '__delete__',
                    lock: '__delete__',
                    open: '__delete__',
                }),
            }
            //!! 如果是运行时生成的文件，内容通常由对应的处理程序 program 创建，并临时写入 _icache_.content
            //!! 不能用真值判断，空字符串 '' 也是有效内容（例如 truncate(0) 之后）
            if (inode._icache_?.content !== undefined) {
                //!! 字符串按值保存，json 对象需要拷贝，避免磁盘数据与运行时数据共享引用
                hdd._content_ =
                    typeof inode._icache_.content === 'string'
                        ? inode._icache_.content
                        : dvCopy(inode._icache_.content)
            }

            //原有 持久化结构
            let ost = addr(inode._ipath_)
            //!! 未持久化过的节点 直接返回新生成的
            if (!ost) {
                //!! _content_ 是必须的
                if (!hdd._content_) hdd._content_ = {}
                return hdd as DvFsHddStruct
            }
            //已经持久化过的数据，则覆盖
            //!! 这里的 ost 就是 fs 中的响应式节点，原地合并才能同步写回磁盘数据（persist 才会保存）
            const nhdd = dvExtend<DvFsHddStruct>(ost, hdd)
            if (!nhdd._content_) nhdd._content_ = {}
            return nhdd
        }

        //用户登录后，将 usign 键名下的 user 目录完整的映射为 内存树中的 user 目录
        //!! dvHdd.fs.[iso:uuid].user 与 dvMem.fs.user 目录结构完全一致
        const mntUserDir = (): DvFsMemStruct | undefined => {}

        //系统设置数据，如果用户已登录，则会合并用户设置，computed 只读
        const sysConfig = computed<PlainObject | undefined>(() => {
            const conf = fs['/sys/config']?._content_
            const usign = uSign()
            if (!usign || !fs[usign]) return conf
            const uconf = fs[usign]['/sys/config'] ?? {}
            //!! dvExtend 会原地修改 target，必须以 {} 作为 target，避免污染全局配置
            return dvExtend({}, conf ?? {}, uconf)
        })
        //数据库|数据模型 schema，如果用户已登录，则会合并用户设置
        const getDbSchema = (db: string, model?: string): PlainObject | undefined => {
            const ipath = `/mnt/${db}${model ? '/' + model : ''}`
            const schema = fs[ipath]
            const usign = uSign()
            if (!usign || !fs[usign]) return schema
            const uschema = fs[usign][ipath] ?? {}
            //!! dvExtend 会原地修改 target，必须以 {} 作为 target，避免污染全局 schema
            return dvExtend({}, schema ?? {}, uschema)
        }
        //用户登录后，获取用户安装的 program 节点列表，返回内存树结构 DvFsMemStruct[]
        const getUserProgramInodes = (): DvFsMemStruct[] => {
            const usign = uSign()
            if (!usign || !fs[usign] || !fs[usign].program) return []
            const uprog = fs[usign].program
            if (!dvIs.nemobj(uprog)) return []
            //将 dvHdd 数据转换为 dvMem 数据
            const rtn: DvFsMemStruct[] = []
            for (const pn in uprog) {
                const pi = uprog[pn]
                if (!pi || !pi._content_) continue
                const mpi = toMemStruct(pi)
                if (!mpi) continue
                rtn.push(mpi)
            }
            return rtn
        }

        //将传入的 DvFsHddStruct 持久化节点，按 ipath 写入 dvHdd.fs
        const fsync = async (ipath: string, fnode: DvFsHddStruct): Promise<boolean> => {
            ipath = ipu.norm(ipath)

            //系统文件 /sys/*
            if (ipath.startsWith('/sys/')) {
            }

            //用户数据
        }

        return {
            fs,

            addr,
            toMemStruct,
            toHddStruct,

            sysConfig,

            getDbSchema,
            getUserProgramInodes,

            fsync,
        }
    },
    {
        //dvHdd 磁盘数据需要持久化
        persist: true,
    },
)

//返回 store 类型
export type DvHddStore = ReturnType<typeof useDvHddStore>
