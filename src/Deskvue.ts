/**
 * Deskvue 是基于 Vue3 + pinia 构建的前端框架，是 Spf(Simple PHP Framework) 后端框架的配套前端组件系统
 *
 * Deskvue 的设计初衷，是在浏览器中模拟 OS 的某些特征，比如：
 *  0   dvMemStore 基于 pinia ，模拟 OS 中的 memory 内存系统
 *      dvMemStore 不会持久化，仅存在于内存中，每次 Deskvue 系统启动时都会重新构建一整套数据结构：
 *          {
 *              # 构建 FS 文件树
 *              fs: { ... },
 *
 *              # 缓存 Deskvue 系统的运行时数据
 *              sys: Record<string, any>,
 *
 *              # 缓存全局服务组件的 运行时数据
 *              service: {
 *                  # gui 服务 运行时数据
 *                  '/dv/service/gui': {
 *                      #
 *                  },
 *                  ...
 *              },
 *
 *              # 缓存任意 DvProgramInode 应用的运行时数据
 *              !! program 应用组件可能支持多实例，因此缓存数据是 Record<string, any>[] 数组
 *              !! program 应用组件实例内部保存 pidx 序号，指向这里的缓存数组中的 序号
 *              program: {
 *                  '/program/***': [
 *                      # pidx == 0
 *                      {
 *                          ... program 应用实例的 运行时数据
 *                      },
 *                      ...
 *                  ],
 *                  ...
 *              },
 *
 *              # Vue 组件实例的 ShallowRef
 *              instance: {
 *                  # service 服务组件单例
 *                  service: Record<'/dv/service/***', ShallowRef<DvFooBarServiceInstance>>,
 *                  # DvProgramInode 应用组件实例
 *                  !! program 应用组件可能支持多实例，因此 ShallowRef 是数组
 *                  !! 应用组件实例内部需要保存 pidx
 *                  program: Record<'/program/***', ShallowRef<DvFooBarProgramInstance>[]>,
 *              }
 *          }
 *      任意系统或第三方 DvProgramInode 应用在启动时，如果需要，可以在 dvMemStore.program{} 中创建自有的数据结构
 *          在页面会话存续过程中，这些数据会一直存在，并且全局共享
 *          DvProgramInode 应用被结束时，会自动清理 dvMemStore.program.** 数据
 *      Deskvue 框架自身的必要的运行时数据也存放在 runtime 中：dvMemStore.sys{...}
 *      页面会话结束时，dvMemStore 自然销毁
 *
 *  1   DvInode 类，模拟 OS 中的 FS 文件系统的一个基本 inode 文件节点
 *      Deskvue kernel 启动时，会初始化 dvMemStore 然后在 dvMemStore.fs 初始化一个树状结构：
 *          {
 *              # 构建 FS 文件树
 *              !! 当用户登录后，会对这里的文件树做出修剪，以适应用户的 权限
 *              fs: {
 *                  # Deskvue 系统内部的核心文件
 *                  !! /dv 每次启动都会生成，不会持久化
 *                  dv: {
 *                      !! /dv 是 DvDirInode 类型的 文件节点，定义此节点的 元数据
 *                      !! 操作 /dv 时，将会实例化 DvDirInode 类，这是 DvInode 的派生类
 *                      !! 任意文件节点的 _ipath_ 是全局唯一的
 *                      _ipath_: '/dv',
 *                      _inode_: {
 *                          mode: 'dir',    文件节点类型 dir --> DvDirInode
 *                          auth: 101,      rwx 可读可执行
 *                          lock: 0,
 *                          time: {a:0, c:0, m:0, d:0},
 *                          !! 此文件的引用者，其他文件节点的 _ipath_[] 数组
 *                          !! 为空表示没有引用者
 *                          !! 当 explorer 资源管理器对某个 dir 进行 list 时
 *                          !!      其内部的所有文件都会添加 引用者 /program/explorer
 *                          !!      explorer 启动时默认指向 /
 *                          !!      此时 /dv,/program,... 等根文件节点的 open 都会自动添加 /program/explorer
 *                          open: [],
 *                          name: 'dv'      文件节点的 显示名称
 *                      },
 *                      _icache_: {
 *                          !! dir 类型的文件节点的 内容缓存，是曾经打开过的子文件节点的 _ipath_[]
 *                          !! 这个数据会话存续期间，一直存在
 *                          _snode_: [ '/dv/update', ... ],
 *                      },
 *
 *                      # update 服务上一次获取到的最新更新数据
 *                      !! 此文件是 DvUpdateInode 类型
 *                      !! 此文件会被持久到 dvHddStore.fs.dv.update
 *                      update: {
 *                          _ipath_: '/dv/update',
 *                          _inode_: {
 *                              mode: 'update',     文件节点类型 update --> DvUpdateInode
 *                              auth: 001,          仅执行
 *                              lock: 0,
 *                              time: {
 *                                  a: 0,
 *                                  c: 0,
 *                                  m: 毫秒时间戳,   上一次远程获取此文件内容
 *                                  d: 0,
 *                              },
 *                              open: [],
 *                              name: 'update',
 *                          },
 *                          !! 文件内容缓存，仅当此文件被读取时，才会从 dvHddStore.fs.dv.update._icache_ 读取到这里
 *                          !! 当文件引用者 [] 为空时，会清除这里的数据
 *                          _icache_: {
 *                              updateHash: '',
 *                              update: {},
 *                              remoteConfigHash: '',
 *                              remoteConfig: {},
 *                              ...
 *                          }
 *                      },
 *
 *                      # service 全局服务组件列表
 *                      !! 全局服务列表初始获取：
 *                          内核启动完成，Deskvue 的 plugin.install 执行并注册所有全局组件，以及 第三方业务库 setup 执行
 *                          所有全局组件注册后，筛选存在 options.serviceMeta 参数的组件
 *                          自动向 /dv/service 节点下挂载这些 组件作为子文件节点，自动生成 _ipath_ _inode_ 数据，
 *                      !! 持久化到用户数据的 是最终实际启用的全局服务，保存在 dvHddStore.fs.user.[uuid].dv.service
 *                      !! 在用户登录成功后，将会把启用标记添加到各对应服务文件节点的 _inode_.extra 中
 *                      service: {
 *                          _ipath_: '/dv/service',
 *                          _inode_: {
 *                              mode: 'dir',
 *                              auth: 101,
 *                              lock: 0,
 *                              time: {...},
 *                              open: [],
 *                              name: 'service',
 *                          },
 *                          _icache_: {
 *                              !! _snode_ 保存的是启动的 全局组件 _ipath_
 *                              _snode_: [
 *                                  '/dv/service/cmd',
 *                                  '/dv/service/gui',
 *                                  '/dv/service/request',
 *                                  ...
 *                              ],
 *                          },
 *
 *                          # gui 全局服务
 *                          !! 文件节点类型是 service 指向 DvServiceInode 类，是 DvInode 的派生类
 *                          gui: {
 *                              _ipath_: '/dv/service/gui',
 *                              _inode_: {
 *                                  mode: 'service',    --> DvServiceInode
 *                                  auth: 101,
 *                                  lock: 0,
 *                                  time: {...},
 *                                  open: [],
 *                                  name: 'service',
 *                                  !! DvServiceInode 实例化必须的额外参数
 *                                  extra: {
 *                                      !! 标记 options.serviceMeta{} 参数的组件名
 *                                      component: 'DvGuiService',
 *                                      !! 持久化到用户数据中启用标记，默认全部启用
 *                                      enabled: true,
 *                                  }
 *                              },
 *                              _icache_: {
 *                                  # DvGuiService.options.serviceMeta 中定义的参数
 *                                  name: '',
 *                                  isSysService: true,     标记这是系统服务，必须启用
 *                                  props: {...},
 *                                  auths: {...},           这里指定的 auth 影响到 _inode_.auth
 *                                  ...
 *                              },
 *                          },
 *
 *                          !! 其他服务组件...
 *                      },
 *
 *                      !! 其他系统文件...
 *                  },
 *
 *                  # program 应用列表
 *                  !! /program 目录不会持久化，每次启动时，以及用户登录时，会生成应用列表
 *                  !! 系统应用列表不会被持久化，每次会自动生成
 *                  !! 第三方 DvProgram 应用列表本身会被持久化到 dvHddStore.fs.user.[uuid].program
 *                  !! 用户登录后，会执行一次权限过滤，失去操作权限的 DvProgram 应用，会从列表中删除
 *                  !! 用户也可以手动刷新应用列表
 *                  !! 应用列表的初始构建过程：
 *                      内核启动完成后，Deskvue 会执行 plugin.install 注册所有全局组件，然后会执行所有第三方业务库的 setup
 *                      其中会自行注册业务库中的全局组件，所有组件注册完成后，筛选出包含 options.programMeta 参数的组件
 *                      自动向 /program 节点下挂载这些应用作为子文件节点，自动生成 _ipath_ _inode_ 数据，
 *                      用户登录后，读取用户的持久化数据 dvHddStore.fs.user.[uuid].program
 *                      比对自动生成的，与用户持久化的应用列表，生成最终内存中的应用列表 dvMemStore.fs.program
 *
 *                  program: {
 *                      _ipath_: '/program',
 *                      _inode_: {
 *                          mode: 'dir',    --> DvDirInode
 *                          auth: 111,      可读可写可执行
 *                          !! 文件节点一旦标记为可写，增加 脏数据 标记
 *                          modi: 0,
 *                          lock: 0,
 *                          time: {...},
 *                          open: [],
 *                          name: 'program',
 *                      },
 *                      _icache_: { _snode_: [] },
 *
 *                      # 系统应用
 *                      explorer: {
 *                          _ipath_: '/program/explorer',
 *                          _inode_: {
 *                              !! program 类型，指向 DvProgramInode 类，是 DvInode 派生类
 *                              mode: 'program',
 *                              auth: 001,      仅执行
 *                              lock: 0,
 *                              time: {...},
 *                              open: [],
 *                              name: 'explorer',
 *                              !! DvProgramInode 类实例化时 必须的额外参数
 *                              extra: {
 *                                  !! 必须的，指向实际的 Vue 组件名，必须是全局注册的组件
 *                                  !! 且必须在组件 options 中包含：programMeta 参数
 *                                  component: 'DvExplorer',
 *                              },
 *                          },
 *                          !! program 类型文件被打开时，将会读取 _inode_.extra.component 指向的 Vue 组件定义
 *                          !! 读取组件 options.programMeta{} 复制到这里
 *                          !! 如果 _inode_.open[] 为空了，则清除这里的数据
 *                          _icache_: {
 *                              # DvExplorer.options.programMeta 中定义的参数
 *                              name: '',
 *                              title: '资源管理器',      这里指定的 program 名称显示在 explorer 资源管理器中
 *                              isSysProgram: true,     标记这是系统应用
 *                              multipleInstance: false,    此 program 是否支持多实例
 *                              mimes: [],              定义此应用可以打开的 mime 文件类型，或者后缀名，*.ext 形式
 *                              props: {...},
 *                              auths: {...},           这里指定的 auth 影响到 _inode_.auth
 *                              ...
 *                          },
 *                      },
 *
 *                      # 非系统应用
 *                      pmsPlaner: {
 *                          _ipath_: '/program/pmsPlaner',
 *                          _inode_: {
 *                              !! 可以自定义 DvInode 子类，此处 DvPmsProgramInode
 *                              mode: 'pmsProgram',
 *                              auth: 111,
 *                              modi: 0,
 *                              lock: 0,
 *                              time: {},
 *                              open: [],
 *                              name: 'pmsPlaner',
 *                              extra: { component: 'PmsPlaner' }
 *                          },
 *                          _icache_: {
 *                              # 来自 PmsPlaner.options.programMeta 中的参数
 *                              name: '',
 *                              title: '',
 *                              isSysProgram: false,
 *                              multipleInstance: true,
 *                              mimes: [ '*.plan' ],
 *                              ...
 *                          }
 *                      },
 *
 *                      !! 其他应用...
 *                  },
 *
 *                  !! 用户数据，这些数据会被持久化到 dvHddStore.fs.user.[uuid].desktop
 *                  # 保存在 desktop 桌面上的数据
 *                  desktop: {
 *                      _ipath_: '/desktop',
 *                      _inode_: {
 *                          mode: 'desktopDir',     --> DvDesktopDirInode 派生自 DvDirInode
 *                          auth: 111,
 *                          modi: 0,
 *                          lock: 0,
 *                          time: {},
 *                          open: [],
 *                          name: 'desktop',
 *                      },
 *                      _icache_: { _snode_: [] },
 *
 *                      # shortcut 快捷方式
 *                      sc_[md5(program.ipath + program.props)]: {
 *                          _ipath_: '/desktop/sc_[md5(program.ipath + program.props)]',
 *                          _inode_: {
 *                              mode: 'shortcut',   --> DvShortcutInode
 *                              auth: 111,
 *                              modi: 0,
 *                              lock: 0,
 *                              time: {},
 *                              open: [],
 *                              name: '显示的名称',
 *                              extra: {
 *                                  !! 快捷方式需要指定 Dv***Inode._ipath_
 *                                  program: '/program/explorer',
 *                                  !! 如果指向 DvProgramInode 还可以指定启动参数
 *                                  props: {...}
 *                              }
 *                          },
 *                          !! 快捷方式的 icache == 对应的 program 的 icache
 *                          _icache_: {...}
 *                      },
 *
 *                      # widget 桌面小组件
 *                      wg_[md5(component + props)]: {
 *                          _ipath_: '/desktop/wg_[md5(component + props)]',
 *                          _inode_: {
 *                              mode: 'widget',   --> DvWidgetInode
 *                              auth: 111,
 *                              modi: 0,
 *                              lock: 0,
 *                              time: {},
 *                              open: [],
 *                              name: '显示的名称',
 *                              extra: {
 *                                  !! 快捷方式需要指定小组件的实际 Vue 组件名，需要包含 options.widgetMeta{} 参数
 *                                  component: 'DvFooWidget',
 *                                  !! 还可以指定启动参数
 *                                  props: {...}
 *                              }
 *                          },
 *                          _icache_: {
 *                              !! 组件 options.widgetMeta{}
 *                          }
 *                      },
 *
 *                      # 任意普通文件
 *                      fs_202610011020304569: {
 *                          !! 创建文件时，会自动分配全局唯一 文件名
 *                          !! 用户修改的文件名，保存在 _inode_.name 中，仅作为显示名称
 *                          _ipath_: '/desktop/fs_202610011020304569',
 *                          _inode_: {
 *                              mode: 'file',   --> DvFileInode 真实的文件
 *                              auth: 111,
 *                              modi, lock, time, open,
 *                              name: '用户命名',
 *                              extra: {
 *                                  !! file 类型文件必须指定 mime 或 *.ext 后缀名
 *                                  mime: '*.plan' 或 'text/plain'
 *                              },
 *                          },
 *                          _icache_: {
 *                              !! 普通文件节点的 缓存数据，通常保存对应的 program 应用的 ipath
 *                              program: '/program/pmsPlaner',
 *                              !! 文件的实际内容，通常保存在对应 program 的缓存中：
 *                              !!      dvMemStore.program.[/program/omsPlaner].fileCache.[/desktop/fs_..]
 *                          },
 *                      },
 *
 *                      # 任意普通文件夹
 *                      fs_20261001102023256259: {
 *                          _ipath_: '/desktop/fs_20261001102023256259',
 *                          _inode_: {
 *                              mode: 'dir',   --> DvDirInode
 *                              auth: 111,
 *                              modi, lock, time, open,
 *                              name: '用户命名',
 *                          },
 *                          _icache_: {
 *                              _snode_: [],
 *                          },
 *                      },
 *                  },
 *              }
 *          }
 *
 *      通过 持久化的 pinia 数据 dvHddStore 模拟 HDD 硬盘数据结构，dvHddStore.fs
 *      其结构与 dvMemStore.fs 结构基本一致，只是在保存文件实际数据时，有不同的行为：
 *          !! 在持久化的数据结构中，会保存文件的实际内容
 *          !! 保存在 dvHddStore.fs.user.[uuid].[path_to_file]._content_
 *          通常分为 2 种情况：
 *              0   真是保存在远程服务器中的文件 *.xlsx | *.docx | *.webp 等真实文件，仅保存实际的文件 url
 *              1   在 Deskvue 会话中才有实际意义的虚拟文件，
 *                  例如：
 *                      正在操作的某个出库单，*.ot
 *                      某个生产流程，*.plan
 *                      某个填写中的数据模型记录，*.r  *.rs  *.nr
 *                      !! 会在 文件节点 inode.extra.mime 中为这些文件指定一个后缀名
 *                  会在 持久化的 pinia 数据中以 json 形式保存数据
 *
 *      DvInode 基类，描述一个基本的文件节点，通常包含以下结构：
 *          {
 *              !! 全局唯一的 文件路径字符串，实际显示的文件名可以与 ipath 中的名称不一致
 *              ipath: '/foo/bar',
 *              !! 文件节点的 inode 数据
 *              inode: {
 *                  !! 此文件节点的类型，对应着实际的 DvInode 子类，例如：DvDirInode
 *                  !! 针对此类型文件节点的所有可用操作，都定义在这个 DvInode 子类中
 *                  mode: 'dir',
 *                  !! 子文件节点的操作权限，rwx 读、写、执行，0|1 == false|true
 *                  auth: 100,  仅可读
 *                  !! 当此文件节点 可写 时，增加 脏数据标记
 *                  !! ==1 表示此文件节点的 inode 数据被修改
 *                  !! 如果此文件需要被持久化，则需要修改用户数据 dvHddStore.fs.user.[uuid]
 *                  modi: 0,
 *                  !! 锁，根据 open 引用数组自动切换
 *                  lock: 0,
 *                  !! 文件操作时间戳，毫秒
 *                  time: {
 *                      a: 创建时间戳,
 *                      c: inode 数据修改时间戳,
 *                      m: 文件内容被修改时间戳,
 *                      d: 文件被删除的时间戳
 *                  },
 *                  !! 此文件的引用者，其他文件节点的 _ipath_[] 数组
 *                  !! 为空表示没有引用者，此时 lock 恢复为 0
 *                  !! 当 explorer 资源管理器对某个 dir 进行 list 时
 *                  !!      其内部的所有文件都会添加 引用者 /program/explorer
 *                  !!      explorer 启动时默认指向 /
 *                  !!      此时 /dv,/program,... 等根文件节点（dir 类型）的 open 都会自动添加 /program/explorer
 *                  open: [],
 *                  !! 在 explorer 中实际显示的文件名
 *                  name: '',
 *
 *                  !! 某些 DvInode 子类，实例化时必须的额外参数，例如 DvProgramInode
 *                  extra: {
 *                      !! DvProgramInode 文件类型需要指定实际指向的 Vue 组件名
 *                      component: 'DvExplorer',
 *                  },
 *              },
 *              !! 文件节点的 缓存数据
 *              !! 在 DvInode 文件节点实例中，此属性指向 dvMemStore.fs.[ipath]._icache_ 响应式数据
 *              icache() => dvMemStore.fs.[ipath]._icache_,
 *
 *
 *          }
 *
 *
 * Spf + Deskvue 是完全基于 生产型企业的管理系统后台需求 开发的一套解决方案，主要用于：
 *  0   生产型企业的 生产管理系统 PMS(Production Management System) ：
 *          物料品种信息、采购计算、采购跟踪、库存、出入库；
 *          成品品种信息、定制品种、合规化数据（标签、配料 等）、配方管理（修订、版本 等）、成品库存、出入库、发货与配送；
 *          生产计划、自动排产、自动计算物料清单、生产步骤可视化、步骤负责人、出入库联动、合规化批生产记录；
 *          订单创建、自动分批、对接生产流程；
 *          以及配套的：
 *              员工信息、员工组管理（部门、车间、工段、班、组）、员工角色权限；
 *              供应商管理、资质、审计；
 *              客户管理、合规化信息、定制信息；
 *              财务相关的 物料与成品的定期库存盘点、成本核算（按时间、品种 等）；
 *              设备设施信息登记、合规化管理（设备维护保养记录、台账等）
 *  1   生产型企业线上直销的 支撑系统 OMS(Orders Management System)，支撑自建的订货小程序、各大电商平台的后台商品数据配套 等：
 *          商品品种信息、套餐搭配、折扣系统、卡券；
 *              底层直接对接 PMS 系统的成品品种信息、成品库存信息、复用 PMS 的发货与配送管理能力；
 *          配套的：
 *              线上客户信息、配送信息、购物车；
 *              订单信息、订单流程、可视化；
 *  2   其他企业管理需求：
 *          文档系统（公司规章制度、SOP、标准等业务文件或法规文件的 版本化管理）；审批流程；公告与通知；
 *          HR 管理 员工信息登记、入职、停职、转岗、职责权限、门禁、考勤、加班、请销假；
 *          非生产使用的物料品种信息、采购、库存、出入库；
 *          财务相关的 报销审批流程、员工薪资（根据考勤以及请销假、加班等信息，自动计算）；
 *          其他...
 *
 * Deskvue 是基于 Vue3+Pinia 开发的前端组件库
 * 默认适配 cgyio/spf 后端框架（默认包含 Spf-Orm 数据库模块）
 *
 * Deskvue 系统不通过 route 组织界面，而是在浏览器端实现了一套 窗口管理系统
 * 所有功能性组件都以 窗口形式组织和管理，用户可以像使用 OS 原生窗口一样使用这些 DvWindow 窗口实例
 *      拖拽，缩放，层叠，最大化最小化，关闭，模态 ...
 *
 * 已开启的 DvWindow 窗口实例，会被缓存到 dvRuntime.tasklist 中
 * 同时此窗口的 窗口ID、业务组件名，组件props 等数据会被缓存到 dvAccount.tasklist 中并持久化
 * DvWindow 默认情况下是 keep-alive 的，通过 md5(业务组件名+props) 得到窗口ID，并以此作为不同窗口的区分
 *
 * 非业务的窗口，例如对话框、警告等，应使用 dvAlert|dvMessage|dvConfirm|... 这些窗口不会进入 tasklist，不会被缓存，不会 keep-alive
 *
 *
 *
 * 完整使用方式：
 * !! Deskvue 库必须通过 CDN 方式使用，全局挂在 window.Deskvue
 *
 * <link rel="stylesheet" href="//cdn/deskvue.css" />
 * <link rel="stylesheet" href="//cdn/bz/foo-bar.css" />
 * <link rel="stylesheet" href="//cdn/bz/jaz-tom.css" />
 *
 * <script src="//cdn/vue.prod.js"></script>
 * <script src="//cdn/pinia.prod.js"></script>
 * <script src="//cdn/deskvue.iife.js"></script>
 * <script src="//cdn/bz/foo-bar.iife.js"></script>
 * <script src="//cdn/bz/jaz-tom.iife.js"></script>
 * <script type="module">
 * await Deskvue.start('#app', {
 *    # 指定要使用的 业务组件库
 *    business: {
 *        FooBar,
 *        JazTom: {
 *          lib: JazTom,
 *          options: {
 *            业务库的 install 参数
 *          }
 *        }
 *    }
 * })
 * </script>
 *
 *
 *
 * 此文件 ./src/Deskvue.ts 是 iife 打包的入口文件，同时也是 业务库开发时导入 Deskvue 模块的 入口文件
 * !! 应在 vite.config.ts 中 build.lib.entry 配置项中指向此文件
 *
 * iife 打包后得到结构：
 * globalThis.Deskvue = {
 *    # Deskvue 插件定义
 *    pluing: {...},
 *
 *    # start 全局启动方法，包含了 createApp(), app.mount() 等操作
 *    start,
 *
 *    # useDvFooBarStore 系列方法
 *    dvStores: { useDvRootStore, ... },
 *
 *    # useDvStore 快捷方法
 *    useDvStore,
 *
 *    # 各 store 的实例类型
 *    DvRootStore, ...
 *
 *    # store 中定义的 类型
 *    DvRootOption, DvStage, ...
 *
 *    # 各 dv-* 组件中定义的 类型
 *    DvDesktopProps, ...
 *
 *    # utils/core 中的工具函数
 *    dvWait, dvUntil, ...
 *  }
 *
 *
 * !! 业务组件库 开发阶段
 * main.ts
 * import * as Deskvue from '@/Deskvue'
 * import * as BzLib from '@/business/bz-lib'
 * globalThis.Deskvue = Deskvue
 * await Deskvue.start('#app', {
 *    business: {
 *       # 正在开发 的 业务库
 *       BzLib: {
 *          lib: BzLib,
 *          options: { ... 业务库启动参数 }
 *       },
 *       ... 可以有多个业务库
 *    }
 * })
 *
 * !! 开发业务组件时，应将业务组件库放置到 @components/business/[组件库名] 路径下
 * 开发的业务组件内部，可以直接从 @/Deskvue 导入需要的 Deskvue 模块
 * <script setup>
 * import { useDvStore, type DvStage, dvUntil } from '@/Deskvue'
 * const dvRuntime = useDvStore('runtime')
 * const foo = async () => {
 *    await dvUntil(()=>true)
 *    //then...
 * }
 * </script>
 * !! 其他业务组件库相关数据，应分别放到对应路径下：
 *    @stores/business/[组件库名]/
 *    @styles/business/[组件库名]/
 *    @utils/business/[组件库名]/
 *    ...
 * !! 创建 @business/[组件库名].ts 作为业务组件库 iife 导出的入口文件
 * !! 业务组件开发完成后，应将 vite.config.lib.entry 指向这个文件，同时修改 rolldownOptions 参数，即可只打包此业务组件库
 * iife 打包得到结构：
 * globalThis.BzLib = {
 *    # 插件定义，其中将所有业务组件注册为 异步组件
 *    plugin: {...},
 *
 *    # 可选的 async setup 方法，用于 初始化依赖，根据账号权限生成可用组件列表，等
 *    setup,
 *
 *    # 依赖的 store
 *    bzLibStores: { useBzLibFooStore, ... },
 *
 *    # 可选快捷方法
 *    useBzLibStore,
 *
 *    # store 实例类型
 *    BzLibFooStore, ...
 *
 *    # 其他类型
 *    BzLibTypeFoo, ...
 *
 *    # 各业务组件的类型定义
 *    BzLibFooBarProps, ...
 *
 *    # 工具方法等
 *    ...
 * }
 * !! 业务组件开发完成后，应将 vite.config.lib.entry 指向这个文件，即可只打包此业务组件库
 *
 */

//需要加载的 Deskvue 库的所有 样式文件
//import './styles/main.css'
//import './styles/tailwind.css'
import './styles/Deskvue.scss'

//Deskvue kernel
import { start as kernelStart } from '@/kernel'

//全局错误处理
//import { setupDvGlobalErrorHandler } from '@utils/error'
//所有需要打包导出的 dv-* 组件定义
//import { setupDvComponents, setupDvApps, DvOs, useDvService /*, dvServices*/ } from '@/components'
//自定义指令
//import { setupDvDirectives } from '@/directives'
//全局方法
//import { setupDvGlobals } from '@/utils/global'
//依赖的 store 初始化方法
//import { setupDvStores } from '@/stores'
//处理业务组件库
//import { injectDvBusinessLibs, type DvBzLib } from '@/business'

//其他外部库依赖
import { type App, type Plugin, createApp } from 'vue'
//import ElementPlus from 'element-plus'
//import zhCn from 'element-plus/es/locale/lang/zh-cn'
//import { md5 } from 'js-md5'

//定义 Deskvue 插件 install 参数 options 类型
/*interface DvBzLibOption {
    //lib: DvBzLib
    options?: Record<string, any>
}*/
export interface DvPluginOption {
    //business?: Record<string, DvBzLib | DvBzLibOption>
    [K: string]: any
}

/**
 *
 * Deskvue 插件 install 流程：
 *  0   将 dv-* 系列组件注册为全局组件
 *  1   注册自定义指令
 *  2   注册全局方法  dvWin, dvCmd, ...
 *  3   注入业务组件库  通过 options.business{} 参数传入
 *   !! 业务组件库必须通过 CDN 方式引入，必须挂载到全局 window.FooBar，其结构必须包含：
 *          window.FooBar.plugin    用于 app.use(FooBar.plugin) 其内部将所有业务组件自动注册为 异步组件
 *       !! window.FooBar.setup()   必须 async 用于在 Desktop 启动阶段，自动初始化这个业务组件库（初始化|更新 store 等）
 */
/*export const plugin = {
    install(app: App, options: DvPluginOption = {}) {
        // 0    dv-* 系列组件注册为全局组件
        setupDvComponents(app)
        setupDvApps(app)

        // 1    注册全局自定义指令
        //setupDvDirectives(app)

        // 2    注册全局方法
        //setupDvGlobals(app)

        // 3    注入业务组件库，收集 业务库 setup 方法，缓存到 app.config.globalProperties.$dvBzSetups[] 中
        //if (options?.business) injectDvBusinessLibs(app, options.business)
    },
}*/

/**
 * Deskvue 库启动流程：
 *  0   createApp 创建 app 实例，使用 DvOs 作为根组件
 *  1   初始化依赖的 store，应用 持久化插件，根据 租户隔离iso 以及 账号ID 生成持久化 key，设置 插件 options 到 目标 store
 *  2   use 依赖的 ElementPlus
 *  3   use Deskvue 插件，注册组件、指令、全局方法，注入业务组件，收集业务组件库的 setup 方法
 *  4   app.mount('#app') 渲染组件 DvOs 进入启动流程 dvRuntime.stage = 'starting'
 *      在 DvOs 根组件中，将会：
 *        4.1   显示启动进度条
 *        4.2   渲染核心组件，在核心组件的 onMounted 中修改 dvRuntime.core.[核心组件名].ready = true
 *              4.4.1   启动进度条 --> 50%，dvConfig.coreComponents[] 中核心组件每 ready 一个，进度条自增
 *              4.4.2   DvService 服务组件，提供全局的 通知，chat 等功能，dvRuntime.core.DvService.ready = true
 *              4.4.3   DvCmd 全局命令行组件，提供通过命令行方式执行操作，dvRuntime.core.DvCmd.ready = true
 *              4.4.4   ...其他核心组件
 *        4.2   检查 dvRoot.lastToken
 *              4.2.1   存在 token 则请求 accountInfo 接口，获取账号信息
 *                      4.2.1.1   提示 token 无效，dvRuntime.stage = 'notlogin' 进入 4.2.2 登录流程
 *                      4.2.1.2   正确返回账号信息，进入 4.3 账号个性化 store 准备流程
 *              4.2.2   不存在 token 则 dvRuntime.stage = 'notlogin' 开始登录流程
 *                      4.2.2.1   DvLogin 组件 mount 显示账号登录界面，用户输入账号密码，提交 accountLogin 接口，
 *                      4.2.2.2   等待登录接口返回数据
 *                                4.2.2.2.1   返回正确的 token 缓存到 dvAccount.token，请求 accountInfo 接口，获取账号信息，进入 4.3
 *                             !! 4.2.2.2.2   多次尝试后无法登录，dvRuntime.stage = 'login-error' 终止后续，显示错误界面
 *        4.3   dvRoot.lastAccountId|lastToken 刷新，dvAccount 根据 账号ID 从持久化数据恢复 账号信息，与新拉取的合并，作为当前会话的 账号数据
 *              4.3.1   生成 角色|权限 列表，缓存到 dvAccount.roles|auths|info 更新持久化数据
 *              4.3.2   根据账号ID，将持久化的账号个性化数据，同步到 dvConfig|dvRuntime  例如：桌面快捷方式、小组件、布局、暗黑模式 等用户参数
 *              4.3.3   用户数据同步成功，dvRuntime.stage = 'islogin' 进入 4.4
 *        4.4   账号登录成功，开始渲染核心组件，在核心组件的 onMounted 中修改 dvRuntime.core.[核心组件名].ready = true
 *              4.4.1   启动进度条 --> 50%，dvConfig.coreComponents[] 中核心组件每 ready 一个，进度条自增
 *              4.4.2   DvService 服务组件，提供全局的 通知，chat 等功能，dvRuntime.core.DvService.ready = true
 *              4.4.3   DvCmd 全局命令行组件，提供通过命令行方式执行操作，dvRuntime.core.DvCmd.ready = true
 *              4.4.4   ...其他核心组件
 *        4.5   所有必须的核心组件 mount 成功后 dvRuntime.stage = 'core-ready' 将触发：
 *              4.5.1   启动进度条 --> 100%  然后隐藏
 *              4.5.2   DvDesktop 桌面组件渲染 进入 5
 *  5   DvDesktop 组件渲染
 *        5.1   读取 dvConfig|dvRuntime 中相关参数，创建桌面网格，排列桌面快捷方式，桌面小组件
 *        5.2   启动已持久化的 DvWindow 窗口实例（minimized|maximized|z-index|位置 都会从持久化数据中恢复）
 *        5.3   创建任务栏，任务列表
 *        5.4   调用业务组件库的 setup 方法，拉取业务 store 更新数据（例如：数据表结构等），显示更新进度
 *        5.5   业务 store 更新完成，dvRuntime.stage = 'ready' 系统就绪，启动步骤结束
 */
export const start = async (
    el: string = '#app',
    options: DvPluginOption = {},
): Promise<App<Element>> => {
    //!! Deskvue 启动流程

    // 0  kernelStart 内核启动
    const app = await kernelStart(el, options)

    //!! 全局错误处理
    /*setupDvGlobalErrorHandler()

    // 0  createApp 创建 app 实例，使用 DvOs 作为根组件
    const app = createApp(DvOs)
    //暴露 app 实例到全局
    if (!globalThis.DvApp) globalThis.DvApp = app

    // 1  初始化依赖的 store
    setupDvStores(app)

    // 2  依赖的 ElementPlus
    app.use(ElementPlus, {
        locale: options?.ElementPlusLocale ?? zhCn ?? undefined,
    })*/

    // 3  应用 Deskvue 插件
    //app.use(plugin, options)

    // 4  mount 根组件 DvOs
    //app.mount(el)

    //

    return app
}

//导出全部依赖的 store 以及 useDvStore 方法，挂载在 globalThis.Deskvue 下
//export { dvStores, useDvStore } from '@/stores'

//导出 hooks
//export { dvHooks, useDvHook } from '@/hooks'

//导出 Dv***Service 服务组件入口方法
//export { /*dvServices, */ useDvService }

//导出 工具函数
//export * from '@/utils'
//export { md5 }

//导出 @/types 中所有类型
//export type * from '@/types'

//导出组件类型
//export type * from '@components/types'

//导出 store 定义的类型
//export type * from '@/stores'

//导出 utils 中的类型定义
//export type * from '@utils/types'
