@echo off

if "%~3"=="" (
    echo Usage: %0 output_path input_path delete_input
    exit /b 1
)

set "output_path=%~1"
set "input_path=%~2"
set "delete_input=%~3"

setlocal enabledelayedexpansion

REM Delete all .m3u8 and .mpd files in the input directory if delete_input is true
if /i "%delete_input%"=="true" (
    for %%F in ("%input_path%\*") do (
        if /i "%%~xF"==".m3u8" (
            del "%%F"
        ) else if /i "%%~xF"==".mpd" (
            del "%%F"
        )
    )
)

REM Count the number of files in the input directory
set "count=0"
for %%i in ("%input_path%\*") do (
    set /a count+=1
)

REM If there is exactly one file in the input directory and it is a .mkv file, move it to the output directory
if %count% equ 1 (
    for %%i in ("%input_path%\*") do (
        set "file=%%~ni%%~xi"
        if /i "%%~xi"==".mkv" (
            move "%%i" "%output_path%"
            rd /s /q "%input_path%"
            exit /b 0
        )
    )
)

REM Create a list of all files in the input directory to be merged
set "file_list="
for /f "tokens=*" %%i in ('dir /b "%input_path%\"') do (
    set "file_list=!file_list! "%input_path%\%%i""
)

REM Merge all files listed in file_list into the output_path using mkvmerge
endlocal & (
    mkvmerge -o "%output_path%" %file_list%
)
if errorlevel 2 (
    echo Mkvmerge failed: skipping delete.
) else (
    REM Delete the input directory if delete_input is true and merging was successful
    if "%delete_input%"=="true" (
        rd /s /q "%input_path%"
    )
)
