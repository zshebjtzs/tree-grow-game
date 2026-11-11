#include <windows.h>
#include <wrl.h>
#include <WebView2.h>

#include <cwchar>
#include <filesystem>
#include <string>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace {
constexpr wchar_t kWindowClass[] = L"TreeGrowDesktopWindow";
constexpr wchar_t kVirtualHost[] = L"treegrow.local";
constexpr UINT kSmokeTestFinishedMessage = WM_APP + 1;
constexpr UINT_PTR kSmokeTestTimeoutTimer = 1;

ComPtr<ICoreWebView2Controller> g_controller;
ComPtr<ICoreWebView2> g_webview;
std::filesystem::path g_app_dir;
EventRegistrationToken g_navigation_token{};
EventRegistrationToken g_process_failed_token{};
EventRegistrationToken g_web_message_token{};
bool g_navigation_handler_registered = false;
bool g_process_failed_handler_registered = false;
bool g_web_message_handler_registered = false;
bool g_smoke_test = false;
int g_exit_code = 0;

void CompleteSmokeTest(HWND hwnd, bool success) {
    if (!g_smoke_test) return;
    PostMessageW(hwnd, kSmokeTestFinishedMessage, success ? 1 : 0, 0);
}

void ReportError(HWND hwnd, const wchar_t* message) {
    if (g_smoke_test) {
        OutputDebugStringW(message);
        OutputDebugStringW(L"\n");
        CompleteSmokeTest(hwnd, false);
    } else {
        MessageBoxW(hwnd, message, L"Tree Grow Game", MB_OK | MB_ICONERROR);
    }
}

void RemoveWebViewEventHandlers() {
    if (!g_webview) return;

    if (g_navigation_handler_registered) {
        g_webview->remove_NavigationCompleted(g_navigation_token);
        g_navigation_handler_registered = false;
    }
    if (g_process_failed_handler_registered) {
        g_webview->remove_ProcessFailed(g_process_failed_token);
        g_process_failed_handler_registered = false;
    }
    if (g_web_message_handler_registered) {
        g_webview->remove_WebMessageReceived(g_web_message_token);
        g_web_message_handler_registered = false;
    }
}

void ResizeWebView(HWND hwnd) {
    if (!g_controller || !IsWindow(hwnd)) return;

    RECT bounds{};
    if (GetClientRect(hwnd, &bounds)) {
        const HRESULT hr = g_controller->put_Bounds(bounds);
        if (FAILED(hr)) {
            OutputDebugStringW(L"TreeGrow: WebView2 bounds update failed.\n");
        }
    }
}

bool FindWorkerAsset(std::wstring& filename) {
    const auto assets_dir = g_app_dir / L"www" / L"assets";
    std::error_code error;
    if (!std::filesystem::is_directory(assets_dir, error) || error) return false;

    for (const auto& entry : std::filesystem::directory_iterator(assets_dir, error)) {
        if (error) return false;
        if (!entry.is_regular_file(error) || error) continue;
        const auto name = entry.path().filename().wstring();
        if (name.rfind(L"AIWorker-", 0) == 0 && entry.path().extension() == L".js") {
            // Vite-generated asset names contain only URL-safe filename characters.
            filename = name;
            return true;
        }
    }
    return false;
}

void StartRuntimeSmokeTest(HWND hwnd) {
    std::wstring worker_filename;
    if (!FindWorkerAsset(worker_filename)) {
        ReportError(hwnd, L"Smoke test failed: bundled AI Worker asset was not found.");
        return;
    }

    const std::wstring worker_url =
        L"https://treegrow.local/assets/" + worker_filename;

    // Send a minimal valid tactical position with a forced immediate win. The
    // expected move proves the worker loaded its AI modules, reconstructed the
    // game state, ran move generation/scoring, and returned a real decision.
    const std::wstring script =
        L"(function(){"
        L"if(document.readyState!=='complete'||!document.getElementById('gameCanvas')||"
        L"document.documentElement.dataset.treeGrowAppReady!=='true'||"
        L"document.documentElement.dataset.treeGrowAiWorkerAvailable!=='true'){"
        L"window.chrome.webview.postMessage('TG_SMOKE_FAIL');return 'no-game-dom';}"
        L"try{"
        L"var worker=new Worker('" + worker_url + L"',{type:'module'});"
        L"var finished=false;"
        L"var timer=setTimeout(function(){if(!finished){finished=true;worker.terminate();"
        L"window.chrome.webview.postMessage('TG_SMOKE_FAIL');}},12000);"
        L"worker.onerror=function(){if(!finished){finished=true;clearTimeout(timer);"
        L"worker.terminate();window.chrome.webview.postMessage('TG_SMOKE_FAIL');}};"
        L"worker.onmessage=function(event){if(!finished){finished=true;clearTimeout(timer);"
        L"var data=event.data;var ok=!!data&&data.requestId===1&&!data.error&&data.parentNodeId===2&&data.targetAreaId===6;"
        L"worker.terminate();window.chrome.webview.postMessage(ok?'TG_SMOKE_OK':'TG_SMOKE_FAIL');}};"
        L"worker.postMessage({requestId:1,gameStateData:{nodes:["
        L"{id:1,x:50,y:0,owner:'red',parentId:null,childrenIds:[],isRoot:true,isDestroyed:false,isFrozen:false,areaId:6},"
        L"{id:2,x:40,y:0,owner:'blue',parentId:null,childrenIds:[],isRoot:true,isDestroyed:false,isFrozen:false,areaId:5}],"
        L"currentTurn:'blue',nodeIdCounter:2,isGameOver:false},"
        L"adjacency:{1:[2],2:[1,3],3:[2,4],4:[3,5],5:[4,6],6:[5]},"
        L"areaCenters:[[0,0],[10,0],[20,0],[30,0],[40,0],[50,0]],"
        L"difficulty:'hard',playerSide:'blue',redBaseId:6,blueBaseId:1});return 'worker-started';"
        L"}catch(error){window.chrome.webview.postMessage('TG_SMOKE_FAIL');return String(error);}"
        L"})();";

    SetTimer(hwnd, kSmokeTestTimeoutTimer, 20000, nullptr);
    const HRESULT hr = g_webview->ExecuteScript(
        script.c_str(),
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [hwnd](HRESULT result, LPCWSTR) -> HRESULT {
                if (FAILED(result) && IsWindow(hwnd)) {
                    CompleteSmokeTest(hwnd, false);
                }
                return S_OK;
            }).Get());

    if (FAILED(hr)) {
        KillTimer(hwnd, kSmokeTestTimeoutTimer);
        ReportError(hwnd, L"Smoke test failed: could not execute the WebView2 diagnostic script.");
    }
}

void InitializeWebView(HWND hwnd) {
    const auto web_dir = g_app_dir / L"www";
    if (!std::filesystem::exists(web_dir / L"index.html")) {
        ReportError(hwnd, L"Missing www/index.html. Please keep the www folder beside TreeGrow.exe.");
        return;
    }

    const HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, nullptr, nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [hwnd, web_dir](HRESULT result, ICoreWebView2Environment* environment) -> HRESULT {
                if (!IsWindow(hwnd)) return S_OK;

                if (FAILED(result) || environment == nullptr) {
                    ReportError(hwnd, L"WebView2 Runtime is unavailable. Install the Evergreen WebView2 Runtime and try again.");
                    return S_OK;
                }

                ComPtr<ICoreWebView2Environment> environment_ref = environment;
                const HRESULT controller_hr = environment_ref->CreateCoreWebView2Controller(
                    hwnd,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [hwnd, web_dir, environment_ref](HRESULT controller_result, ICoreWebView2Controller* controller) -> HRESULT {
                            if (!IsWindow(hwnd)) return S_OK;

                            if (FAILED(controller_result) || controller == nullptr) {
                                ReportError(hwnd, L"Failed to create the WebView2 window.");
                                return S_OK;
                            }

                            g_controller = controller;
                            const HRESULT core_result = g_controller->get_CoreWebView2(&g_webview);
                            if (FAILED(core_result) || !g_webview) {
                                g_controller.Reset();
                                ReportError(hwnd, L"Failed to obtain the WebView2 browser interface.");
                                return S_OK;
                            }

                            ComPtr<ICoreWebView2_3> webview3;
                            const HRESULT query_result = g_webview.As(&webview3);
                            if (FAILED(query_result) || !webview3) {
                                g_webview.Reset();
                                g_controller.Reset();
                                ReportError(hwnd, L"This WebView2 Runtime does not support virtual host mapping.");
                                return S_OK;
                            }

                            const auto folder = web_dir.wstring();
                            const HRESULT mapping_result = webview3->SetVirtualHostNameToFolderMapping(
                                kVirtualHost, folder.c_str(),
                                COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
                            if (FAILED(mapping_result)) {
                                g_webview.Reset();
                                g_controller.Reset();
                                ReportError(hwnd, L"Failed to map the local game resources.");
                                return S_OK;
                            }

                            const HRESULT navigation_event_hr = g_webview->add_NavigationCompleted(
                                Callback<ICoreWebView2NavigationCompletedEventHandler>(
                                    [hwnd](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                                        if (!IsWindow(hwnd) || args == nullptr) return S_OK;

                                        BOOL succeeded = FALSE;
                                        if (FAILED(args->get_IsSuccess(&succeeded)) || !succeeded) {
                                            ReportError(hwnd, L"Game page navigation failed. Check that the www folder is complete.");
                                        } else if (g_smoke_test) {
                                            StartRuntimeSmokeTest(hwnd);
                                        }
                                        return S_OK;
                                    }).Get(), &g_navigation_token);
                            if (FAILED(navigation_event_hr)) {
                                g_webview.Reset();
                                g_controller.Reset();
                                ReportError(hwnd, L"Failed to register the page-load diagnostic handler.");
                                return S_OK;
                            }
                            g_navigation_handler_registered = true;

                            const HRESULT process_event_hr = g_webview->add_ProcessFailed(
                                Callback<ICoreWebView2ProcessFailedEventHandler>(
                                    [hwnd](ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs*) -> HRESULT {
                                        ReportError(hwnd, L"The WebView2 browser process failed. Please restart Tree Grow Game.");
                                        return S_OK;
                                    }).Get(), &g_process_failed_token);
                            if (FAILED(process_event_hr)) {
                                RemoveWebViewEventHandlers();
                                g_webview.Reset();
                                g_controller.Reset();
                                ReportError(hwnd, L"Failed to register the browser-process diagnostic handler.");
                                return S_OK;
                            }
                            g_process_failed_handler_registered = true;

                            if (g_smoke_test) {
                                const HRESULT message_event_hr = g_webview->add_WebMessageReceived(
                                    Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                                        [hwnd](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                                            if (!IsWindow(hwnd) || args == nullptr) return S_OK;
                                            LPWSTR message_json = nullptr;
                                            if (SUCCEEDED(args->get_WebMessageAsJson(&message_json)) && message_json) {
                                                const std::wstring message(message_json);
                                                CoTaskMemFree(message_json);
                                                if (message == L"\"TG_SMOKE_OK\"") {
                                                    CompleteSmokeTest(hwnd, true);
                                                } else if (message == L"\"TG_SMOKE_FAIL\"") {
                                                    CompleteSmokeTest(hwnd, false);
                                                }
                                            }
                                            return S_OK;
                                        }).Get(), &g_web_message_token);
                                if (FAILED(message_event_hr)) {
                                    RemoveWebViewEventHandlers();
                                    g_webview.Reset();
                                    g_controller.Reset();
                                    ReportError(hwnd, L"Failed to register the smoke-test message handler.");
                                    return S_OK;
                                }
                                g_web_message_handler_registered = true;
                            }

                            ResizeWebView(hwnd);
                            const HRESULT navigate_result = g_webview->Navigate(L"https://treegrow.local/index.html");
                            if (FAILED(navigate_result)) {
                                RemoveWebViewEventHandlers();
                                g_webview.Reset();
                                g_controller.Reset();
                                ReportError(hwnd, L"Failed to open the local game page.");
                            }
                            return S_OK;
                        }).Get());

                if (FAILED(controller_hr) && IsWindow(hwnd)) {
                    ReportError(hwnd, L"Could not create the WebView2 controller.");
                }
                return S_OK;
            }).Get());

    if (FAILED(hr)) {
        ReportError(hwnd, L"Could not initialize WebView2.");
    }
}

LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
    switch (message) {
    case WM_SIZE:
        ResizeWebView(hwnd);
        return 0;
    case kSmokeTestFinishedMessage:
        if (g_smoke_test) {
            KillTimer(hwnd, kSmokeTestTimeoutTimer);
            g_exit_code = (wparam != 0) ? 0 : 1;
            DestroyWindow(hwnd);
        }
        return 0;
    case WM_TIMER:
        if (g_smoke_test && wparam == kSmokeTestTimeoutTimer) {
            KillTimer(hwnd, kSmokeTestTimeoutTimer);
            CompleteSmokeTest(hwnd, false);
        }
        return 0;
    case WM_DESTROY:
        RemoveWebViewEventHandlers();
        g_webview.Reset();
        g_controller.Reset();
        PostQuitMessage(0);
        return 0;
    default:
        return DefWindowProcW(hwnd, message, wparam, lparam);
    }
}
} // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR command_line, int show_command) {
    g_smoke_test = command_line && wcsstr(command_line, L"--smoke-test") != nullptr;

    wchar_t executable_path[MAX_PATH]{};
    const DWORD path_length = GetModuleFileNameW(nullptr, executable_path, MAX_PATH);
    if (path_length == 0 || path_length >= MAX_PATH) {
        if (g_smoke_test) return 1;
        MessageBoxW(nullptr, L"Could not determine the application directory.", L"Tree Grow Game", MB_OK | MB_ICONERROR);
        return 1;
    }
    g_app_dir = std::filesystem::path(executable_path).parent_path();

    const HRESULT com_result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(com_result)) {
        if (g_smoke_test) return 1;
        MessageBoxW(nullptr, L"Failed to initialize Windows COM.", L"Tree Grow Game", MB_OK | MB_ICONERROR);
        return 1;
    }

    WNDCLASSW window_class{};
    window_class.lpfnWndProc = WindowProc;
    window_class.hInstance = instance;
    window_class.lpszClassName = kWindowClass;
    window_class.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    window_class.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);

    if (!RegisterClassW(&window_class)) {
        if (!g_smoke_test) MessageBoxW(nullptr, L"Failed to register the application window.", L"Tree Grow Game", MB_OK | MB_ICONERROR);
        CoUninitialize();
        return 1;
    }

    HWND hwnd = CreateWindowExW(
        0, kWindowClass, L"Tree Grow Game",
        WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT, CW_USEDEFAULT, 1280, 860,
        nullptr, nullptr, instance, nullptr);

    if (!hwnd) {
        if (!g_smoke_test) MessageBoxW(nullptr, L"Failed to create the application window.", L"Tree Grow Game", MB_OK | MB_ICONERROR);
        CoUninitialize();
        return 1;
    }

    ShowWindow(hwnd, g_smoke_test ? SW_HIDE : show_command);
    UpdateWindow(hwnd);
    InitializeWebView(hwnd);

    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }

    CoUninitialize();
    return g_smoke_test ? g_exit_code : static_cast<int>(message.wParam);
}
