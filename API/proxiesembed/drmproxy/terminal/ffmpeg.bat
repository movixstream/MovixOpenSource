@echo off

if "%~4"=="" (
    echo Usage: %0 output_path input_path mkvmerge_script delete_input
    exit /b 1
)

set "output_path=%~1"
set "input_path=%~2"
set "mkvmerge_script=%~3"
set "delete_input=%~4"

set "ffmpeg_file=%input_path%\ffmpeg.txt"
if exist "%ffmpeg_file%" del "%ffmpeg_file%"
set "final_output=%input_path%\ffmpeg_concat.mkv"
if exist "%final_output%" del "%final_output%"

setlocal enabledelayedexpansion

REM Check if muxing was successful by seeing if fragment folders remained
for /d %%D in ("%input_path%\*") do (
    echo Folders detected in input folder. Skipping ffmpeg.
    exit /b 1
)

REM Get all mkv files and copy their sorted names in a text file for ffmpeg concat
> "%ffmpeg_file%" echo.
for /f "delims=" %%F in ('dir /b /a:-d "%input_path%\*.mkv" ^| sort') do (
    echo file '%%F' >> "%ffmpeg_file%"
)

endlocal & (
    REM Concatenate all the mkv files
    ffmpeg -f concat -safe 0 -i "%ffmpeg_file%" -map 0 -c copy "%final_output%"
)

REM Check if FFmpeg succeeded by verifying if the output file exists
if exist "%final_output%" (
    REM Cleanup and run mkvmerge
    del "%ffmpeg_file%"
    for %%F in ("%input_path%\*.mkv") do (
        if /I not "%%F"=="%final_output%" del "%%F"
    )
    "%mkvmerge_script%" "%output_path%" "%input_path%" "%delete_input%"
) else (
    echo FFmpeg failed: skipping mkvmerge.
)
