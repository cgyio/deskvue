/**
 * Deskvue kernel
 * Deskvue 模拟 Linux 中的 FS 文件系统行为
 * 文件系统相关 TS 类型定义
 *
 * !! 基于 pinia 模拟 内存 和 磁盘
 * !!   dvMem store     内存，不持久化，会话结束自动消失
 * !!   dvHdd store     磁盘，按用户 uuid 和 项目隔离 iso 作为键，执行持久化
 *
 * 在 FS 文件系统初始化阶段（内核初始化阶段），会在 内存(dvMem)中 创建所有必须的目录结构：
 *      /                       全局根目录 base
 *      /sys                    系统文件目录
 *      /sys/config             Deskvue 系统配置参数，reg+ext，*.sys
 *      /sys/update             Deskvue 系统更新以及 remoteConfig 相关，reg+ext，*.sys
 *      /sys/session            保存本次会话的参数(iso,uuid,..)，reg+ext, *.sys
 *      /sys/service            系统服务目录，内部挂载所有 全局服务组件
 *      /program                应用程序目录，内部挂载所有 应用程序组件
 *      /user                   用户文件目录，mime|*.ext|remote 各种类型文件或文件夹
 *      /user/mnt               符号链接，指向 /mnt
 *      /user/share             多用户共享文件目录
 *                              其他用户的共享文件，会以用户名作为显示名称，挂载到此目录
 *      /dev                    字符设备目录，WebUSB 设备
 *      /mnt                    块设备目录，后端数据库、接入的第三方网盘
 *      /run                    sock 目录
 *      /run/request            全局 request 实例
 * !! 自动创建的目录，都不可以修改 inode 数据 权限位都是 101
 *
 * 在内存(dvMem)中的保存方式：
 *      dvMem.fs = {
 *          _ipath_: '/',
 *          _inode_: DvFsInodeMemStruct,
 *          _icache_: {
 *              !! 根目录一定是展开状态，一定包含 _snode_[] 列表
 *              _snode_: ['/sys', '/program', '/user', '/dev', '/mnt', '/run'],
 *          },
 *
 *          !! 根目录下的系统目录结构一定存在，且不可变
 *          sys: {
 *              _ipath_: '/sys',
 *              _inode_: ...,
 *              _icache_: {
 *                  !! 当有程序访问 /sys 下的文件节点时，会创建这个 cache 并记录被访问的子文件节点的 ipath
 *                  _snode_: ['/sys/update']
 *              },
 *
 *              !! 子文件节点以对象键值对形式，直接保存
 *              update: {
 *                  _ipath_: '/sys/update',
 *                  _inode_: ...,
 *                  ...
 *              },
 *
 *              ...
 *          },
 *          program: ...,
 *          user: ...,
 *          dev: ...,
 *          mnt: ...,
 *          run: ...,
 *      }
 *
 * 在磁盘(dvHdd)中的保存方式：
 *      dvHdd.fs = {
 *          !! 系统目录结构不会被持久化，每次内核启动时会自动构建
 *          !! 某些系统文件节点(与用户账号无关的)可能需要持久化，例如：
 *          !! /sys/update (系统更新以及远程配置)
 *          '/sys/update': {
 *              _ipath_: '/sys/update',
 *              _inode_: {
 *                  mode: 'reg',
 *                  ...,
 *                  extra: {
 *                      type: 'ext',
 *                      mime: '*.upd',
 *                  }
 *              },
 *              !! update 文件是 reg 类型，*.upd 后缀名，内容是 PlainObject 直接持久化
 *              _content_: {
 *                  update: { ... 上一次自动更新数据 ... },
 *                  updateHash: '... 上一次自动更新的 hash ',
 *                  updateAt: 上一次自动更新的时间戳,
 *                  config: { ... 上一次远程配置数据 ... },
 *                  configHash: '...',
 *                  configAt: 时间戳,
 *                  ...
 *              }
 *          },
 *          !! /mnt/db_[db name] 远程数据库的 schema
 *          '/mnt/db_[db name]': {
 *              _ipath_': '/mnt/db_[db name]',
 *              _inode_: {
 *                  mode: 'blk',
 *                  ...,
 *                  extra: {
 *                      type: 'db',
 *                      !! 数据库接口参数
 *                      dbk: 'foo_bar 形式的 db-key',
 *                      api: '/db/:db',
 *                      ...
 *                  },
 *              },
 *              _content_: {
 *                  !! 记录数据库级的 schema
 *                  meta: {name:, title:, desc:,},
 *                  models: [...],
 *                  ...
 *              },
 *
 *              !! 记录各数据模型的 schema
 *              '/mnt/db_[db name]/mod_[model name]': {
 *                  _ipath_: '/mnt/db_[db name]/mod_[model name]',
 *                  _inode_: {
 *                      mode: 'reg',
 *                      ...,
 *                      extra: {
 *                          type: 'model',
 *                          !! 数据模型相关参数
 *                          modk: 'foo_bar 形式的 model-key',
 *                          ...
 *                      }
 *                  },
 *                  _content_: {
 *                      !! 记录数据模型级的 schema
 *                      meta: {name:, title:, desc:,},
 *                      columns: [],
 *                      getters: [],
 *                      allColumns: [],
 *                      special: {},
 *                      join: {},
 *                      column: { ... 记录所有字段的 schema },
 *                      ...
 *                  }
 *              }
 *          },
 *          !! 其他需要持久化的 系统文件 ...
 *
 *          !! 根据用户的 uuid + 项目隔离编号 iso 来持久化用户数据
 *          '[iso]:[uuid]': {
 *              !! 与用户账号相关的系统文件，持久化到这里，例如：
 *              !! /sys/service/gui 用户个性化界面参数
 *              '/sys/service/guiService': {
 *                  _ipath_: '/sys/service/guiService',
 *                  _inode_: {
 *                      mode: 'reg',
 *                      ...,
 *                      extra: {
 *                          type: 'program',
 *                          component: 'DvGuiService',
 *                      }
 *                  },
 *                  _content_: {
 *                      !! 记录用户设置的 个性化界面参数
 *                      desktopGridSize: ,
 *                      desktopGridGutter: ,
 *                      desktopPadding: ,
 *                      taskbarSize: ,
 *                      taskbarPosition: ,
 *                      desktopGrid: ,
 *                      desktopGridOccupation: ,
 *                      windowTightness: ,
 *                      windowPadding: ,
 *                      ...
 *                  }
 *              },
 *              !! /program/userProgram 用户自行安装的应用程序，需要持久化
 *              '/program/userProgram': {
 *                  _ipath_: '/program/userProgram',
 *                  _inode_: {
 *                      mode: 'reg',
 *                      ...,
 *                      extra: {
 *                          type: 'program',
 *                          component: '全局注册的第三方 Vue 组件名，且包含 options.programMeta{}',
 *                      }
 *                  },
 *                  _content_: {
 *                      !! 可以记录此程序需要持久化的数据
 *                      ...
 *                  }
 *              },
 *              !! /mnt/db_[db name] 用户对数据库的个性化配置参数
 *              '/mnt/db_[db name]': {
 *                  _content_: {
 *                      !! 仅记录用户修改后的 schema
 *                      ...
 *                  },
 *
 *                  !! 记录用户对各数据模型的配置
 *                  '/mnt/db_[db name]/mod_[model name]': {
 *                      _content_: {
 *                          !! 仅记录用户修改后的 schema
 *                          ...
 *                      }
 *                  }
 *              },
 *
 *
 *              !! 持久化内存中的 user 目录(dvMem.fs.user)，目录结构完全一致
 *              !! 根据其中的文件节点类型，分别生成各自的 _content_
 *              user: {
 *                  ...
 *              }
 *          },
 *      }
 *
 * !! 文件名的行为：
 *      fnode._ipath_ 为全局唯一的文件路径字符串，结构为：/foo/bar/[fid]
 *      [fid] 是文件节点 在父目录节点参数对象中的键名，默认情况下文件显示名称与键名一致
 *      !! 修改文件名称后，显示名称与键名不一致，保存在 dvMem.fs.foo.bar.[fid]._inode_.name 中
 *      !! [fid] 不包含后缀名，如果包含 . 也不会被作为后缀名
 *          文件后缀名由内核根据 fnode._inode_.mode 和 fnode._inode_.extra.type 自动推断
 *          在 资源管理器中显示的后缀名 使用自动推断得到的，以 .ext 形式附加到文件显示名称之后：
 *              例如：/foo/bar/[fid]
 *                  显示名称：nameFoo.aa，推断后缀名 .bb，则在资源管理器中显示为：nameFoo.aa.bb
 *      !! [fid] 文件节点键名命名规则：
 *              不能包含 /
 *              不能使用 dvFsFidKeywords[] 中包含的系统关键字 _ipath_,_inode_,_icache_,_content_..
 *      !! [fid] 文件节点键名的创建：
 *          通过父节点 parentFnode.create('/foo/bar/文件名', {type: ...}) 创建文件节点时：
 *          !! 这通常是用户行为，需要用户提供文件名
 *              !! 会检查传入的文件名是否符合命名规则，不符合会报错：文件名不合法
 *              !! 如果传入的文件名带 .** 后缀，且未传入额外的 type 节点类型参数，会执行：
 *                  裁切最后一个 .** 检查剩余文件名合法性，
 *                      一切正常会自动将新建的文件节点 mode 设为 reg，extra.type 设为 ext，将 .** 写入 extra.mime
 *                      如果文件不合法，则忽略后缀，将其作为文件名本身，检查合法性并创建文件节点
 *          内核自动创建的文件节点，[fid] 完全由内核控制生成，例如：
 *              /sys/update，/sys/service/winService，/program/explorer，/mnt/db_[md5]
 *      !! 对文件节点执行 rename 改名时，传入的名称将被设置为 fnode._inode_.name
 *          !! 同一路径下，不可重名 !! 例如：
 *              存在文件  /foo/bar/aaa  其显示名称为 bbb，则：
 *                  /foo/bar 目录下的其他文件，都不可以将显示名称改为 aaa 或 bbb
 *      !! 在调用文件节点路径字符时，需要区分传入的 是 [fid] 还是 fnode._inode_.name
 *          优先把传入的 文件名作为 [fid] 直接寻址
 *              !! 如果不存在，则尝试作为 _inode_.name
 *          如果传入的文件名包含 .** 后缀，则截取后缀，将剩余的文件名优先作为 _inode_.name
 *          !! 内核调用文件路径一定不会包含后缀名，且一定使用 [fid]
 *
 * !! 需要动态生成的 /program, /sys/service
 *      !! program 文件节点必须对应着一个 全局注册的 Vue 组件
 *      这个组件必须在 defineOptions 中包含 programMeta{} 参数结构体
 *      在 Deskvue 内核启动后，执行 plugin.install 其中会注册所有全局组件，紧接着会执行
 *      所有当前会话引入的所有业务库的 setup 方法，其中会注册所有全局业务组件，所有全局组件
 *      注册完成后，Deskvue 会扫描所有全局组件，筛选出包含 options.programMeta{} 参数结
 *      构体的组件，将这些组件识别为 program 类型的文件节点，自动生成 _ipath_ 和 _inode_
 *      然后会挂载到 dvMem.fs.program 目录下
 *      !! options.programMeta.isService === true 的 program 会挂载到 /sys/service 目录下
 *
 *      系统内置的 program 扫描生成后，会检查 用户持久化数据中的 /program/*** 系列数据
 *      将持久化的内置程序数据，以及用户自行安装的其他应用程序，一起合并到 /program 下
 *
 * !! 可执行的 文件节点类型(reg+program) DvProgramRegInode
 * !! 会模拟 Linux 系统中的 process 进程的部分特征行为：
 *      0   每个启动的 program 程序节点，会生成全局唯一的 pid ，构成形式为：
 *          prog_[program_name]_md5(program 指向的 Vue 组件的启动参数 props{})
 *              允许多实例的 program 程序，每个启动的实例拥有不同的 pid
 *                  !! 也就意味着只有组件 props 不同，才会生成新实例，
 *                  !! 如果 props 与已有实例相同，则只会复用已有实例
 *      1   每个启动的 program 程序节点，会在内存中占据一个区域用于存放运行时缓存数据：
 *              dvMem.program.[pid] = {
 *                  ...储存程序运行时的私有数据
 *              }
 *          program 指向的 Vue 组件是实例会自动挂载到：
 *              dvMem.programInstance.[pid] = ComponentPublicInstance
 *      2   每个启动的 program 程序节点，在对应节点的 _icache_ 中，会有这些结构：
 *              programFnode._icache_ = {
 *                  !! 所有实例共享一个 program 节点句柄实例
 *                  handler: DvProgramRegInode 句柄实例,
 *                  meta: {
 *                      ... 在对应 Vue 组件 options.programMeta{} 中定义的参数
 *                  },
 *
 *                  !! 储存此程序所有已运行实例的 节点相关缓存数据
 *                  program: {
 *                      !! 以 pid 为键名
 *                      [pid]: {
 *                          !! 根路径，默认 /user
 *                          !! service 默认根路径 /
 *                          root: '/user',
 *                          !! 工作路径，默认 /user
 *                          !! 通过 DvProgramRegInode.cd() 可切换工作路径
 *                          !! 工作路径只能是 root 根路径的同级或下级
 *                          dir: '/user',
 *                          !! 保存此应用持有的(打开的)其他 文件节点 ipath[]
 *                          opens: [ '/foo/bar', ... ]
 *                      },
 *                      ...多实例时，其他 pid 数据
 *                  }
 *
 *              }
 *      3   应用的运行时实例，通过调用 opens 中的文件节点的句柄实例，执行对应的操作
 *          _icache_.handler.getProcess(pid).getOpenInode(n).write(...)
 *    !!4   由于不是真实的进程，无法真实意义上的进行 进程隔离
 *          在某个 program 运行时，可以读取执行任意其他运行中的 program 的数据方法
 *          !! 但是一定不要这么做 !! 按以下原则：
 *              某个 program 组件内部通过 computed 读取其他运行中程序的状态数据(只读方式)
 *                  如果目标程序未运行，将返回 undefined 或默认数据
 *              !! 如果一定要操作另一个程序，一定通过 DvProgramHook 提供的 callProgram(pid)
 *                  const result = await callProgram('/foo/bar', 'handlerMethod', ...args)
 *                  !! 这个方法主要是为了操作 service，可以使用专门的 callService(ipath)
 *
 *      5   program 程序启动流程：
 *              用户通过某个 program 程序调用 sysCall(
 *                  'fs:open', '/program/FooBar', {...vue 组件的启动参数 props}
 *              )
 *              优先组装 pid，到 dvMem.program 下查找是否已存在 pid
 *                  已存在则直接复用已有实例，窗口管理器会 active 对应的窗口
 *              不存在 pid 则 FS 文件系统内部会：
 *                  寻址，找到程序节点，创建 _icache_ | _icache_.program.[pid]
 *                  在 dvMem.program 创建新键名 [pid] 初始化默认结构
 *                  窗口管理器会根据 dvMem 数据变化，响应式的在界面挂载对应的 Vue 组件（默认是窗口组件）
 *                  Vue 组件 mount 完成后，会自动将组件实例 挂到 dvMem.programInstance.[pid]
 *                  最后由 Vue 组件实例接管后续的 用户操作
 *
 *
 *
 *
 *
 */

import type { DvInode } from './inode'

//定义可选的 fnode._inode_.mode 文件节点 基本类型
//!! 部分模拟 Linux 文件系统的 文件类型
//!! 不同的文件类型，有不同的操作函数，这些函数由不同的 handler 文件节点句柄类实现
//所有文件节点操作句柄基类 DvInode
export const dvFsInodeModes = [
    'reg', //regular file 普通文件，DvRegInode
    'dir', //directory 目录，DvDirInode
    'lnk', //symlink 符号链接，DvLnkInode
    'chr', //character device 字符设备，DvChrInode
    'blk', //block device 块设备，DvBlkInode
    //'fifo', //named pipe 具名管道
    'sock', //socket 套接字，DvSockInode
] as const
//在文件节点基本类型基础上扩展
//!! Linux 系统中通常是通过文件开头的 魔数 来区分具体类型，Deskvue 直接定义在 fnode._inode_.extra.type 中
//扩展 reg 普通文件类型，每个类型都会指向一个 Dv***RegInode 句柄类
export const dvFsInodeRegTypes = [
    //!! 默认不指定 _inode_.extra.type 表示未知文件类型
    //句柄类是 reg 文件节点的句柄基类 DvRegInode
    //默认把未知类型文件当成纯文本文件来读取
    //可以被持久化到 磁盘(dvHdd)、远程服务器的、网盘中
    '',
    //真实的物理文件，被保存在 远程服务端、网盘中的，带有 mime 类型
    //句柄类 DvMimeRegInode
    'mime',
    //应用程序组件，属于可执行文件节点类型
    //句柄类 DvProgramRegInode
    //!! 此类型文件节点必须指向一个 全局注册的 Vue 组件，
    //!! 且组件在 defineOptions({}) 中必须包含 programMeta{} 参数结构体
    //!! program 模拟了 OS 中 process 进程的部分行为特征
    //!! program 中有一部分特殊的(全局单例，自动启动)应用程序被称为 service
    //!!    service 使用单独的句柄类 DvServiceRegInode
    'program',
    //数据模型(表)类型，作为 blk.db 类型文件节点的子节点类型
    //句柄类 DvModelRegInode
    //!! 一个 model 类型的文件节点 就表示 后端数据库中的一张数据表
    //!! 对数据表的 curd 操作实际就是调用 DvModelRegInode 句柄类的操作方法
    'model',
    //!! ext 类型，没有 mime 只有 *.ext 形式的后缀名
    //句柄类 DvExtRegInode
    //此类文件可以被持久化到 磁盘(dvHdd)、远程服务器端、网盘中
    //文件的实际内容是 json 字符串（在 dvHdd 中保存时就是 PlainObject）
    //仅在 Deskvue 系统中有意义，可以被支持的 program 打开和处理
    //实际的文件行为，由对应的 program 根据后缀名自行处理
    //最常见的这个类型的文件：
    //  快捷方式     *.shortcut     对应 program：DvDesktop DvExplorer
    //  桌面小组件   *.widget       对应 program：DvDesktop
    'ext',
] as const
//扩展 chr 字符设备类型，
//!! 此类型文件节点需要先执行连接操作，连接成功后会被挂载到 dvMem.fs.dev 目录下
//!! 如果需要新增通过其他方式连接的设备类型，需要在此处扩展，并实现对应的 Dv***ChrInode
export const dvFsInodeChrTypes = [
    //所有通过 WebUSB 接口连接到浏览器的设备，都会被抽象为字符设备
    //句柄类 DvUsbChrInode
    //!! WebUSB 接口连接的设备需要用户主动发起连接
    //!! 因此无法在内核初始化时自动挂载，只有用户主动连接时，才会挂载
    'usb',
    //驱动，将一系列相关的功能，封装为一套输入输出协议，通过 ioctl 统一提供对外接口
    //通常由系统内置，或由用户自行安装的 资源
    'driver',
    //剪贴板，也封装为 chr 字符设备
    'clip',
] as const
//扩展 blk 块设备类型
//!! 此类型文件节点需要先执行连接操作，连接成功后会被挂载到 dvMem.fs.mnt 目录下
//!! 如果需要新增通过其他方式连接的块设备类型，需要在此处扩展，并实现对应的 Dv***BlkInode
export const dvFsInodeBlkTypes = [
    //Deskvue 将支持通过标准化 CURD 接口进行操作的数据库，抽象为块设备
    //句柄类 DvDbBlkInode
    //!! 数据库中的 数据模型(表) 会被映射为 此文件节点的子文件节点，类型为 reg.model
    //!! 对任意数据模型(表)的 curd 操作，都被抽象为调用 DvModelRegInode 文件句柄的方法
    'db',
    //Deskvue 支持接入任意第三方网盘系统到 fs 中，网盘抽象为块设备
    //句柄类 DvCloudDriveBlkInode
    //!! 不同的网盘系统有不同的接口(不同的文件节点操作函数集)，因此需要记录网盘类型
    //!! 记录在 fnode._inode_.extra.cloudDrive 中
    //!! 可能还需要其他的网盘参数(账号密码等)，也需要一起记录在 fnode._inode_.extra 中
    'cloud_drive',
    //将浏览器本地的 IndexedDb 挂载为 blk 类型节点
    'idb',
    //通过 File System Access API 挂载的本机文件系统，挂载为 blk 类型
    'local',
    //浏览器本地的 OPFS 挂载为 blk 类型
    'opfs',
] as const
//扩展 sock 套接字类型
//!! 此类型的文件节点，默认挂载到 dvMem.fs.run 目录下
//!! 要新增其他类型的 sock 节点，在此处扩展，并实现 Dv***SockInode
export const dvFsInodeSockTypes = [
    //Deskvue 中将全局统一的 request 请求动作抽象为 sock 类型
    //句柄类 DvRequestSockInode
    //!! 按请求的 url 不同，以及请求参数的不同，生成不同的 requestId
    //!! 然后构成文件节点的 _ipath_ 文件节点挂载到 dvMem.fs.run.request 目录下
    //!! 请求动作完成后，文件节点默认是不会删除的，用于结果复用，需要手动删除文件节点
    //!! 如果请求参数中指定了不缓存结果，则会在请求结束后，自动删除此文件节点
    'request',
] as const
export type DvFsInodeMode = (typeof dvFsInodeModes)[number]
export type DvFsInodeType =
    | (typeof dvFsInodeRegTypes)[number]
    | (typeof dvFsInodeChrTypes)[number]
    | (typeof dvFsInodeBlkTypes)[number]
    | (typeof dvFsInodeSockTypes)[number]
//文件节点的 操作权限 类型定义
//!! 操作权限由 rwx权限位+owner 决定
//!! 权限判定时，优先读取 当前登录用户的用户标识(通常是 iso:uuid) 与 文件节点的 _inode_.owner 比对
//!!    _inode_.owner === 当前用户的 iso:uuid 时，相当于 _inode_.auth === 111
//!!    _inode_.owner === 'user' 时，根据 _inode_.auth 决定权限
//!!    _inode_.owner === 其他用户的 iso:uuid 时，相当于 _inode_.auth === 100
//!!    _inode_.owner === 'root' 时，无任何权限，_inode_.auth === 0
//!! 在 内核启动 | 根组件加载 | 用户登录之前，当前用户标识一定是 root
//!!    用户身份标识是 root 时，使用 super 特权，跳过所有权鉴
//!! 当 program 程序启动时，在 program 程序内部，要判定文件节点权限，则：
//!!    根据 programInode._inode_.owner 返回用户标识：
//!!        owner === root                             返回 root
//!!        owner === user | 当前用户的 iso:uuid        返回当前登录用户的 iso:uuid
//!!        owner === 其他用户的 iso:uuid   通常不可能，其他用户的 program 没有 x 执行权限，不会启动
export type DvFsInodeAuth = 0 | 1 | 10 | 11 | 100 | 101 | 110 | 111
export type DvFsInodeOwner = 'root' | 'user' | `${DvFsUsign}`
export type DvFsCaller = 'root' | `${DvFsUsign}`
export type DvFsUsign = `${string}:${Uuid}`
//定义每次 sysCall 发生时的 调用上下文类型
export interface DvFsCallContext {
    //调用者，程序内部调用可以传入 '' ，内核启动期间以及裸调用 默认是 root
    caller: '' | DvFsCaller
    //调用操作发生在哪个 程序(进程)中，指定 ipath， 裸调用默认是 /sys/prog0
    program: string
    //指定进程 pid 不指定默认是 programNode._icache_.program{} 中的第一个进程
    pid: string
    //可扩展
    [K: string]: any
}
//文件节点的 脏标记 类型定义
export type DvFsInodeModi = 0 | 1
//文件节点的 锁标记 类型定义
export type DvFsInodeLock = 0 | 1
//文件节点的 时间戳 类型定义
export type DvFsInodeTime = {
    a: number //创建 毫秒
    c: number //inode 修改 毫秒
    m: number //内容修改 毫秒
    d: number //删除 毫秒
}
export const dvFsEmptyInodeTime = {
    a: 0,
    c: 0,
    m: 0,
    d: 0,
}
//文件节点的 extra 额外数据，会根据 inode.mode 有所不同
export interface DvFsInodeExtra {
    //type 可选，未指定时表示 未知文件类型（等同 reg 的 ''）
    //!! 部分 mode（如 lnk）没有细分类型，其 extra 可不含 type
    type?: DvFsInodeType
    //mime 针对 reg 文件类型，可以指定 mime 或 *.ext 形式的 后缀名
    mime?: string

    //根据文件具体类型的不同，指定各自的 extra 参数
    [K: string]: any
}
//文件节点在内存中的 _icache_ 参数结构
export interface DvFsInodeIcache {
    handler: null | DvInode
    [K: string]: any
}
//持久化到磁盘(dvHdd)的 基本文件节点的 _inode_ 参数描述结构
export interface DvFsInodeHddStruct {
    //文件节点的基础类型
    mode: DvFsInodeMode
    //文件节点的操作权限 rwx 读|写|执行
    auth: DvFsInodeAuth
    //文件节点的拥有者，与 auth 一起参与权限运算
    owner: DvFsInodeOwner
    //文件节点的时间戳
    time: DvFsInodeTime
    //文件节点的 显示名称，仅显示，不参与 _ipath_
    name: string
    //文件节点的 extra 额外参数，根据 mode 不同，会有不同的结构
    extra?: DvFsInodeExtra
}
//内存(dvMem)中的 基本文件节点的 _inode_ 参数描述结构
export interface DvFsInodeMemStruct {
    mode: DvFsInodeMode
    auth: DvFsInodeAuth
    owner: DvFsInodeOwner
    time: DvFsInodeTime
    name: string
    extra?: DvFsInodeExtra

    //在持久化结构基础上 增加
    //文件节点可写时，增加 脏标记，标记文件节点被修改，需要被写入持久化(dvHdd)
    modi: DvFsInodeModi
    //文件锁标记
    lock: DvFsInodeLock
    //文件节点的 引用计数，需要记录所有引用此文件节点的 其他文件节点的 _ipath_
    //!! open[] 不为空，则 lock = 1，否则 lock = 0
    open: string[]
}
//持久化到磁盘(dvHdd)的 基本文件节点的参数描述结构
export interface DvFsHddStruct {
    //全局唯一的 文件节点定位字符串，形式为 /foo/bar...
    //!! 手动创建文件时，指定的文件名必须不能与同路径下的 fid 以及 显示名称 重复
    //!! 手动修改文件名，仅仅是修改 fnode._inode_.name
    //!! 手动修改文件后缀名实际上也是修改 fnode._inode_.name
    //!! 真实的文件后缀名会根据 fnode._inode_.mode 和 fnode._inode_.extra.mime 推断
    _ipath_: string
    _inode_: DvFsInodeHddStruct
    //!! 针对指定了 *.ext 后缀名的文件，这些文件不是真正的 mime 类型文件，仅在 Deskvue 会话期间有意义
    //!! 这些文件的实际内容，是 json 对象，需要直接持久化到 dvHdd store
    //!! 针对保存在远程服务端，或者第三方网盘内的真实文件(拥有 mime 类型)，需要在 dvHdd 中保存其 url
    //!! 如果是未指定 mime 和 后缀名的 普通文件，一律作为纯文本文件，需要在此保存文件内容
    _content_: string | PlainObject
    //dir 类型的文件节点，还要保存子文件节点
    [K: string]: any
}
//内存(dvMem)中的 基本文件节点的参数描述结构
export interface DvFsMemStruct {
    _ipath_: string
    _inode_: DvFsInodeMemStruct

    //在持久化结构基础上增加 运行时文件节点 数据缓存
    //!! 文件节点的运行时缓存数据结构，根据 mode 和 extra.type 会有所不同
    //!! 如果此文件节点被引用，一定存在 _icache_.handler 指向此文件节点的 句柄实例
    _icache_: DvFsInodeIcache

    [K: string]: any
}

//空值，用于句柄类默认属性填充
export const dvFsEmptyMemStruct: DvFsMemStruct = {
    _ipath_: '',
    _inode_: {
        mode: 'reg',
        auth: 0,
        owner: 'root',
        time: dvFsEmptyInodeTime,
        name: '',
        modi: 0,
        lock: 1,
        open: [],
    },
    _icache_: { handler: null },
}

//!! 不可以作为文件节点 fid 的系统关键字
export const dvFsFidKeywords = ['_ipath_', '_inode_', '_icache_', '_content_']

//定义针对文件节点的可能操作名称
export const dvFsInodeOps = []

//创建文件节点时的 opts 参数
export type DvFsInodeCreateOptions = {
    //指定要创建的 节点 mode
    mode?: DvFsInodeMode
    //不同 mode 下不同的 type
    type?: DvFsInodeType
    //权限 rwx
    auth?: DvFsInodeAuth
    //所有者
    owner?: DvFsInodeOwner
    //reg+ext 类型，额外指定 mime 可以是标准 mime 或 *.ext 后缀名
    mime?: string

    //可覆盖默认的 _inode_ 参数
    inode?: Partial<DvFsInodeMemStruct>

    [K: string]: any
}

//针对 reg 类型普通文件，定义 read|write 额外参数结构
export interface DvFsRegInodeReadOptions {
    //纯文本，可指定读取的内容长度
    size?: number

    //reg+ext 类型，内容为 json 对象，可以：
    //指定要读取的 键名
    keys?: string[]
    //指定要返回 {} 对象，还是 json 字符串，默认返回对象
    stringify?: boolean

    [K: string]: any
}
export interface DvFsRegInodeWriteOptions {
    //是否立即刷盘
    immediate?: boolean

    //reg+ext 类型，内容为 json 对象，可以：
    //使用 dvExtend 合并，默认 false 直接覆盖
    extend?: boolean

    [K: string]: any
}

//可执行的 文件节点类型 DvProgramRegInode
//!! program 应用程序启动后，会表现出部分 Linux 系统中的 process 进程的特征行为：
//  0   会在内存中占据一个区域用于存放运行时缓存数据：
//          dvMem.program.[/program/***] = {}
//      !! 如果应用支持多实例，这个运行时缓存是一个 PlainObject[] 数组
//          dvMem.program.[/program/***] = [ {} ]
//  1   在对应的文件节点的 _icache_ 中，会保存此应用持有的(打开的)其他 文件节点 ipath[]
//          fnode._icache_.opens = [ '/foo/bar', '/a/b/c' ]
//      !! 如果应用支持多实例，_icache_.opens = [ [...], ... ] 二维数组
//  2   应用通过调用 opens 中的文件节点的句柄实例，执行对应的操作

//!! program 文件节点必须对应着一个 全局注册的 Vue 组件
//  这个组件必须在 defineOptions 中包含 programMeta{} 参数结构体
//  在 Deskvue 内核启动后，执行 plugin.install 其中会注册所有全局组件，紧接着会执行
//  所有当前会话引入的所有业务库的 setup 方法，其中会注册所有全局业务组件，所有全局组件
//  注册完成后，Deskvue 会扫描所有全局组件，筛选出包含 options.programMeta{} 参数结
//  构体的组件，将这些组件识别为 program 类型的文件节点，自动生成 _ipath_ 和 _inode_
//  然后会挂载到 dvMem.fs.program 目录下
//定义 programMeta 参数结构
type _progAcType = 'user' | 'sys' | 'kernel'
export interface DvFsProgramMeta {
    //元数据
    name: string //应用名称，DvExplorer
    title: string //应用标题，资源管理器，将作为 _inode_.name
    desc?: string
    //!! service 标记，默认 false
    //!! service 是特殊的 program ，全局单例，文件节点会挂载到 dvMem.fs.sys.service 目录下
    isService?: boolean
    //service 额外参数
    service?: {
        //是否需要保持运行，默认 false
        //!! 如果是 kernel 内核服务，此处默认 true
        keepAlive: boolean

        //!! 下面这些参数在 service 被收集时自动生成，手动指定无效
        //service 类型，默认 user
        type: _progAcType
    }
    //标记区分是 Deskvue 自带的还是外部业务库带入的 program
    //默认不指定，自动根据扫描操作来推断
    isSysProgram?: boolean
    //是否自启动，默认 false
    isAutoStart?: boolean
    //!! 应用是否支持多实例，默认 true
    //!! service 类型此属性无效
    isMultiple?: boolean
    //!! 定义此应用可以打开的文件的 mime|*.ext
    mimes: string[]
    //此 程序|服务 必须依赖的其他 服务
    //!! 只有 服务程序 才可以被依赖
    //!! 可指定 服务名称(组件名称) 或 完整 ipath
    dependency?: string[]
    //GUI 显示参数
    gui?: {
        //程序图标
        icon?: string
        iconProps?: PlainObject
        //窗口参数
        winProps?: PlainObject
        [K: string]: any
    }
    //支持扩展
    [K: string]: any
}
//定义 program 类型文件节点的 fnode._inode_.extra 参数结构
export interface DvFsProgramRegInodeExtra extends DvFsInodeExtra {
    //type 只能是 program
    type: 'program'
    //!! 组件名字符串，必须指向一个已经全局注册的 Vue 组件，可以是异步组件
    component: string
}
//定义 program 类型文件节点参数中 进程对应的 参数结构
export interface DvFsPidCache {
    //此进程可操作的 根路径，默认 /user ，service 默认为 /
    root: string
    //此进程当前的 操作目录 cwd
    dir: string
    //此进程使用到的 其他文件节点资源的 ipath[]
    opens: string[]
    //此进程对应的 Vue 组件的 启动参数
    props?: PlainObject
    //此进程的内存初始数据
    memInit?: PlainObject

    [K: string]: any
}
//定义 program 类型文件节点的 fnode._icache_ 参数结构
export interface DvFsProgramRegInodeIcache extends DvFsInodeIcache {
    meta?: DvFsProgramMeta
    program?: Record<string, DvFsPidCache>
}
//程序文件节点 数据类型
export interface DvFsMemProgramStruct extends DvFsMemStruct {
    _icache_: DvFsProgramRegInodeIcache
}

//内存中的 所有运行中的 program 程序信息结构
//由 任务管理器(DvTaskService) 和 窗口管理器(DvWinService) 渲染为看到的 窗口界面
export interface DvFsPidItem {
    //全局进程 id
    pid: string
    //对应的 program 节点 ipath
    ipath: string
    //对应的 Vue 组件的 名称，组件一定是全局注册的，可通过 <component :is=""> 动态组件挂载
    name: string
    //对应的 vue 组件的 programMeta
    meta: DvFsProgramMeta
    //对应的 Vue 组件的启动参数 props
    props?: PlainObject

    [K: string]: any
}

//program 程序节点的 复合类型
export type DvFsProgramType = `${'kernel' | 'sys' | 'user'}-${'service' | 'program'}`

//用户的 profile
export interface DvFsUserProfile {
    uuid: Uuid
    name: string

    auths?: string[]
    roles?: string[]

    [K: string]: any
}

//iso 项目隔离 项目参数
export interface DvFsIsoInfo {
    //项目隔离标识  ms.qypms 形式
    iso: string
    //项目名称
    name: string
    //项目的 baseUrl
    baseUrl: string
    //项目 logo
    logo?: string

    [K: string]: any
}

//用户登录后的 session 会话文件 _icache_ 内容结构
export interface DvFsSessionIcache extends DvFsInodeIcache {
    //登录用户的 信息
    uuid: Uuid
    //uSign 用户标识 iso:uuid 形式
    uSign: DvFsUsign
    //用户 profile
    profile: DvFsUserProfile
    //项目隔离项目参数
    iso: DvFsIsoInfo
}

//会话文件节点 数据类型
export interface DvFsMemSessionStruct extends DvFsMemStruct {
    _icache_: DvFsSessionIcache
}
