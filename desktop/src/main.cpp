#include <windows.h>
#include <wrl.h>
#include <WebView2.h>

#include <filesystem>
#include <string>

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
    if (!g_controller) return;
    RECT bounds{};
    GetClientRect(hwnd, &bounds);
    g_controller->put_Bounds(bounds);
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
                if (FAILED(result) || environment == nullptr) {
                    ShowStartupError(L"WebView2 Runtime is unavailable. Install the Evergreen WebView2 Runtime and try again.");
                    return S_OK;
                }

                environment->CreateCoreWebView2Controller(
                    hwnd,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [hwnd, web_dir, environment](HRESULT controller_result, ICoreWebView2Controller* controller) -> HRESULT {
                            if (FAILED(controller_result) || controller == nullptr) {
                                ShowStartupError(L"Failed to create the WebView2 window.");
                                return S_OK;
                            }

                            g_controller = controller;
                            g_controller->get_CoreWebView2(&g_webview);

                            const auto folder = web_dir.wstring();
                            const HRESULT mapping_result = g_webview->SetVirtualHostNameToFolderMapping(
                                kVirtualHost, folder.c_str(),
                                COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
                            if (FAILED(mapping_result)) {
                                ShowStartupError(L"Failed to map the local game resources.");
                                return S_OK;
                            }

                            ResizeWebView(hwnd);
                            g_webview->Navigate(L"https://treegrow.local/index.html");
                            return S_OK;
                        }).Get());
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
    GetModuleFileNameW(nullptr, executable_path, MAX_PATH);
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
