cmake_minimum_required(VERSION 3.24)
project(TreeGrowDesktop LANGUAGES CXX)

if(NOT WIN32)
  message(FATAL_ERROR "TreeGrowDesktop is a Windows-only application.")
endif()

if(NOT DEFINED WEBVIEW2_SDK_DIR)
  message(FATAL_ERROR "Set WEBVIEW2_SDK_DIR to the Microsoft.Web.WebView2 NuGet build/native directory.")
endif()

add_executable(TreeGrow WIN32 src/main.cpp)
target_compile_features(TreeGrow PRIVATE cxx_std_17)
target_compile_definitions(TreeGrow PRIVATE UNICODE _UNICODE NOMINMAX WINVER=0x0A00 _WIN32_WINNT=0x0A00)
target_include_directories(TreeGrow PRIVATE "${WEBVIEW2_SDK_DIR}/include")
target_link_directories(TreeGrow PRIVATE "${WEBVIEW2_SDK_DIR}/x64")
target_link_libraries(TreeGrow PRIVATE WebView2LoaderStatic ole32 shlwapi)

set_target_properties(TreeGrow PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/out"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/out"
)

# Embed a Per-Monitor DPI V2 manifest. The legacy dpiAware element provides
# a Per-Monitor V1 fallback on older Windows 10 releases.
if(MSVC)
  target_link_options(TreeGrow PRIVATE
    "/MANIFEST:EMBED"
    "/MANIFESTINPUT:${CMAKE_CURRENT_SOURCE_DIR}/TreeGrow.manifest"
  )
endif()
