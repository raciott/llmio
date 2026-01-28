import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FaHome,
  FaCloud,
  FaRobot,
  FaFileAlt,
  FaSignOutAlt,
  FaCog,
  FaKey,
  FaSnowflake,
  FaHeartbeat,
  FaAtom
} from "react-icons/fa";
import { useTheme } from "@/components/theme-provider";
import { useSnow } from "@/components/snow-effect";
import { getVersion, checkLatestRelease, type GitHubRelease } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function Layout() {
  const [version, setVersion] = useState("dev");
  const [latestRelease, setLatestRelease] = useState<GitHubRelease | null>(null);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const { theme, setTheme } = useTheme();
  const { snowEnabled, setSnowEnabled } = useSnow();
  const navigate = useNavigate();
  const location = useLocation(); // 用于高亮当前选中的菜单
  const token = localStorage.getItem("authToken")?.trim() || "";
  const isAuthKeyToken = token.startsWith("sk-github.com/racio/llmio-");

  useEffect(() => {
    if (isAuthKeyToken) {
      return undefined;
    }
    let active = true;

    const fetchVersion = async () => {
      try {
        const value = await getVersion();
        if (active && value) {
          setVersion(value);
        }
      } catch {
        // Keep default version when API is unreachable or unauthorized.
      }
    };

    void fetchVersion();

    return () => {
      active = false;
    };
  }, []);

  // Check for updates when on home page
  useEffect(() => {
    if (isAuthKeyToken) {
      return;
    }
    if (location.pathname === '/') {
      const checkForUpdates = async () => {
        try {
          const release = await checkLatestRelease('raciott', 'llmio');
          if (release && release.tag_name !== version) {
            setLatestRelease(release);
            setShowUpdateDialog(true);
          }
        } catch (error) {
          console.error('Failed to check for updates:', error);
        }
      };

      void checkForUpdates();
    }
  }, [location.pathname, version]);

  const handleLogout = () => {
    localStorage.removeItem("authToken");
    navigate("/login");
  };

  const navItems = [
    { to: "/", label: "首页", icon: <FaHome /> },
    { to: "/health-ui", label: "健康监控", icon: <FaHeartbeat /> },
    { to: "/providers", label: "提供商管理", icon: <FaCloud /> },
    { to: "/models", label: "模型管理", icon: <FaRobot /> },
    { to: "/logs", label: "请求日志", icon: <FaFileAlt /> },
    { to: "/auth-keys", label: "API Key 管理", icon: <FaKey /> },
    { to: "/config", label: "系统配置", icon: <FaCog /> },
  ];

  return (
    <div className="flex flex-col h-screen w-full dark:bg-gray-900 transition-colors duration-300">
      
      {/* 1. 顶部栏 Header */}
      <header className="bg-background flex items-center flex-shrink-0 z-20">
        <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-3 py-3 md:px-4">
          <div className="group flex items-center gap-2 text-xl font-bold">
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20 transition-all duration-300 group-hover:bg-primary/20 group-hover:ring-primary/40 group-hover:shadow-md">
              <FaAtom className="size-4 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-105" />
            </span>
            <span
              className="text-primary text-2xl transition-all duration-300 group-hover:text-transparent group-hover:bg-clip-text"
              style={{ backgroundImage: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--foreground)))" }}
            >
              Orvion
            </span> 
          </div>

          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="text-muted-foreground cursor-pointer hover:bg-accent transition-colors"
              onClick={() => latestRelease && setShowUpdateDialog(true)}
              title={latestRelease ? `有新版本 ${latestRelease.tag_name} 可用` : '当前版本'}
            >
              {version}
              {latestRelease && (
                <span className="ml-1 text-xs text-red-500">●</span>
              )}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className={`hover:bg-accent hover:text-accent-foreground ${snowEnabled ? 'text-blue-400' : ''}`}
              onClick={() => setSnowEnabled(!snowEnabled)}
              title={snowEnabled ? "关闭下雪效果" : "开启下雪效果"}
            >
              <FaSnowflake className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="hover:bg-accent hover:text-accent-foreground"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              width="24" height="24" viewBox="0 0 24 24" 
              fill="none" stroke="currentColor" strokeWidth="2" 
              strokeLinecap="round" strokeLinejoin="round" 
              className="size-5"
            >
              <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
              <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"></path>
              <path d="M12 3l0 18"></path>
              <path d="M12 9l4.65 -4.65"></path>
              <path d="M12 14.3l7.37 -7.37"></path>
              <path d="M12 19.6l8.85 -8.85"></path>
            </svg>
          </Button>
          
          <Button 
            variant="ghost" 
            onClick={handleLogout}
            className="gap-2"
          >
            <FaSignOutAlt />
          </Button>
        </div>
        </div>
      </header>

      {/* 2. 下方主体区域 */}
      <div className="flex-1 min-w-0">
        <div className="mx-auto flex h-full w-full max-w-[1200px] px-3 md:px-4">
          <div className="flex w-full overflow-y-hidden min-w-0">
        
        {/* 左侧侧边栏 Sidebar */}
        {!isAuthKeyToken && (
          <aside
            className="mr-4 mt-3 md:mt-5 flex w-16 shrink-0 flex-col items-center self-start rounded-[30px] bg-card/90 py-5 shadow-[0_12px_32px_rgba(0,0,0,0.12)] ring-1 ring-border/40 backdrop-blur-sm"
          >
            <nav>
              <ul className="flex flex-col items-center gap-3">
                {navItems.map((item) => {
                  const isActive = location.pathname === item.to;
                  return (
                    <li key={item.to}>
                      <Link to={item.to}>
                        <div
                          className={`
                            group relative flex size-11 items-center justify-center rounded-2xl transition-all duration-200
                            ${isActive
                              ? "bg-amber-100 text-amber-900 shadow-sm ring-1 ring-amber-200/80 dark:bg-amber-200/10 dark:text-amber-200 dark:ring-amber-200/30"
                              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                            }
                          `}
                          title={item.label}
                          aria-label={item.label}
                        >
                          <span className="text-lg transition-transform duration-200 group-hover:scale-105">
                            {item.icon}
                          </span>
                          <span className="sr-only">{item.label}</span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </aside>
        )}

        {/* 右侧主内容区域 */}
        <main className="flex-1 min-w-0 bg-muted/20 p-2 md:p-4 transition-all duration-300">
          <div className="mx-auto max-w-full h-full min-w-0 overflow-x-hidden">
             <Outlet />
          </div>
        </main>
          </div>
        </div>
      </div>

      {/* Update Dialog */}
      <Dialog open={showUpdateDialog} onOpenChange={setShowUpdateDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>发现新版本 {latestRelease?.tag_name}</DialogTitle>
            <DialogDescription>
              当前版本: {version} → 最新版本: {latestRelease?.tag_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2">更新内容：</h4>
              <div className="bg-muted p-4 rounded-md text-sm whitespace-pre-wrap max-h-96 overflow-y-auto">
                {latestRelease?.body || '暂无更新说明'}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowUpdateDialog(false)}
              >
                稍后提醒
              </Button>
              <Button
                onClick={() => {
                  window.open(latestRelease?.html_url, '_blank');
                  setShowUpdateDialog(false);
                }}
              >
                查看详情
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
