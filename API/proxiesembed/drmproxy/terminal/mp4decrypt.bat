@echo off

if "%~3"=="" (
    echo Usage: %0 input_path keys delete_input
    exit /b 1
)

set "input_path=%~1"
set "keys=%~2"
set "delete_input=%~3"

if "%keys%"=="" (
    exit /b 0
)

setlocal enabledelayedexpansion

for /f "tokens=*" %%i in ('dir /b "%input_path%\*"') do (
    set "input_file=%%i"
    set "filename=%%~ni"
    set "extension=%%~xi"
    set "output_file=!filename!_decrypted!extension!"
    mp4decrypt %keys% "%input_path%\!input_file!" "%input_path%\!output_file!"

    if "%delete_input%"=="true" (
        if exist "%input_path%\!output_file!" (
           for %%A in ("%input_path%\!output_file!") do (
                if %%~zA equ 0 (
                    del "%input_path%\!output_file!"
                ) else (
                    del "%input_path%\!input_file!"
                )
            )
        )
    )
)