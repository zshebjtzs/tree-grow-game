#include <windows.h>
#include <wrl.h>
#include <WebView2.h>

#include <filesystem>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace {
constexpr wchar_t kWindowClass[] = L"TreeGrowDesktopWindow";
constexpr wchar_t kVirtualHost[] = L"treegrow.local";

ComPtr<ICoreWebView2Controller> g_controller;
ComPtr<ICoreWebView2> g_webview;
std::filesystem::path g_app_dir;

void ShowStartupError(const wchar_t* message) {
    MessageBoxW(nullptr, message, L"Tree Grow Game", MB_OK | MB_ICONERROR);
}

void ResizeWebView(HWND hwnd) {
    if (!g_controller || !IsWindow(hwnd)) return;

    RECT bounds{};
    if (GetClientRect(hwnd, &bounds)) {
        g_controller->put_Bounds(bounds);
    }
}

void InitializeWebView(HWND hwnd) {
    const auto web_dir = g_app_dir / L"www";
    if (!std::filesystem::exists(web_dir / L"index.html")) {
        ShowStartupError(L"Missing www/index.html. Please keep the www folder beside TreeGrow.exe.");
        return;
    }

    const HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, nullptr, nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [hwnd, web_dir](HRESULT result, ICoreWebView2Environment* environment) -> HRESULT {
                // The window may have been closed while WebView2 initialized.
                if (!IsWindow(hwnd)) return S_OK;

                if (FAILED(result) || environment == nullptr) {
                    ShowStartupError(L"WebView2 Runtime is unavailable. Install the Evergreen WebView2 Runtime and try again.");
                    return S_OK;
                }

                // Keep the COM environment alive until the asynchronous controller
                // creation callback has completed.
                ComPtr<ICoreWebView2Environment> environment_ref = environment;
                const HRESULT controller_hr = environment_ref->CreateCoreWebView2Controller(
                    hwnd,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [hwnd, web_dir, environment_ref](HRESULT controller_result, ICoreWebView2Controller* controller) -> HRESULT {
                            if (!IsWindow(hwnd)) return S_OK;

                            if (FAILED(controller_result) || controller == nullptr) {
                                ShowStartupError(L"Failed to create the WebView2 window.");
                                return S_OK;
                            }

                            g_controller = controller;
                            const HRESULT core_result = g_controller->get_CoreWebView2(&g_webview);
                            if (FAILED(core_result) || !g_webview) {
                                g_controller.Reset();
                                ShowStartupError(L"Failed to obtain the WebView2 browser interface.");
                                return S_OK;
                            }

                            ComPtr<ICoreWebView2_3> webview3;
                            const HRESULT query_result = g_webview.As(&webview3);
                            if (FAILED(query_result) || !webview3) {
                                ShowStartupError(L"This WebView2 Runtime does not support virtual host mapping.");
                                return S_OK;
                            }

                            const auto folder = web_dir.wstring();
                            const HRESULT mapping_result = webview3->SetVirtualHostNameToFolderMapping(
                                kVirtualHost, folder.c_str(),
                                COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
                            if (FAILED(mapping_result)) {
                                ShowStartupError(L"Failed to map the local game resources.");
                                return S_OK;
                            }

                            // Surface navigation and renderer failures instead of leaving
                            // the user with an unexplained blank window.
                            g_webview->add_NavigationCompleted(
                                Callback<ICoreWebView2NavigationCompletedEventHandler>(
                                    [hwnd](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                                        if (!IsWindow(hwnd) || args == nullptr) return S_OK;

                                        BOOL succeeded = FALSE;
                                        if (SUCCEEDED(args->get_IsSuccess(&succeeded)) && !succeeded) {
                                            ShowStartupError(L"Game page navigation failed. Check that the www folder is complete.");
                                        }
                                        return S_OK;
                                    }).Get(), nullptr);

                            g_webview->add_ProcessFailed(
                                Callback<ICoreWebView2ProcessFailedEventHandler>(
                                    [hwnd](ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs*) -> HRESULT {
                                        if (IsWindow(hwnd)) {
                                            ShowStartupError(L"The WebView2 browser process failed. Please restart Tree Grow Game.");
                                        }
                                        return S_OK;
                                    }).Get(), nullptr);

                            ResizeWebView(hwnd);
                            const HRESULT navigate_result = g_webview->Navigate(L"https://treegrow.local/index.html");
                            if (FAILED(navigate_result)) {
                                ShowStartupError(L"Failed to open the local game page.");
                            }
                            return S_OK;
                        }).Get());

                if (FAILED(controller_hr) && IsWindow(hwnd)) {
                    ShowStartupError(L"Could not create the WebView2 controller.");
                }
                return S_OK;
            }).Get());

    if (FAILED(hr)) {
        ShowStartupError(L"Could not initialize WebView2.");
    }
}

LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
    switch (message) {
    case WM_SIZE:
        ResizeWebView(hwnd);
        return 0;
    case WM_DESTROY:
        g_webview.Reset();
        g_controller.Reset();
        PostQuitMessage(0);
        return 0;
    default:
        return DefWindowProcW(hwnd, message, wparam, lparam);
    }
}
} // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int show_command) {
    wchar_t executable_path[MAX_PATH]{};
    const DWORD path_length = GetModuleFileNameW(nullptr, executable_path, MAX_PATH);
    if (path_length == 0 || path_length >= MAX_PATH) {
        ShowStartupError(L"Could not determine the application directory.");
        return 1;
    }
    g_app_dir = std::filesystem::path(executable_path).parent_path();

    const HRESULT com_result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(com_result)) {
        ShowStartupError(L"Failed to initialize Windows COM.");
        return 1;
    }

    WNDCLASSW window_class{};
    window_class.lpfnWndProc = WindowProc;
    window_class.hInstance = instance;
    window_class.lpszClassName = kWindowClass;
    window_class.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    window_class.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);

    if (!RegisterClassW(&window_class)) {
        ShowStartupError(L"Failed to register the application window.");
        CoUninitialize();
        return 1;
    }

    HWND hwnd = CreateWindowExW(
        0, kWindowClass, L"Tree Grow Game",
        WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT, CW_USEDEFAULT, 1280, 860,
        nullptr, nullptr, instance, nullptr);

    if (!hwnd) {
        ShowStartupError(L"Failed to create the application window.");
        CoUninitialize();
        return 1;
    }

    ShowWindow(hwnd, show_command);
    UpdateWindow(hwnd);
    InitializeWebView(hwnd);

    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }

    CoUninitialize();
    return static_cast<int>(message.wParam);
}
