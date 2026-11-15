if [ "$#" -ne 4 ]; then
    echo "Usage: $0 output_path input_path mkvmerge_script delete_input"
    exit 1
fi

output_path="$1"
input_path="$2"
mkvmerge_script="$3"
delete_input="$4"

ffmpeg_file="$input_path/ffmpeg.txt"
final_output="$input_path/ffmpeg_concat.mkv"

[ -f "$ffmpeg_file" ] && rm "$ffmpeg_file"
[ -f "$final_output" ] && rm "$final_output"

# Check if muxing was successful by seeing if fragment folders remained
if find "$input_path" -mindepth 1 -type d | read; then
    echo "Folders detected in input folder. Skipping ffmpeg."
    exit 1
fi


# Get all mkv files and copy their sorted names in a text file for ffmpeg concat
touch "$ffmpeg_file"
find "$input_path" -type f -name "*.mkv" -printf "file '%f'\n" | sort -V > "$ffmpeg_file"

# Concatenate all the mkv files
ffmpeg -f concat -safe 0 -i "$ffmpeg_file" -map 0 -c copy "$final_output"

# Check if FFmpeg succeeded by verifying if the output file exists
if [ -f "$final_output" ]; then
    # Cleanup and run mkvmerge
    rm -f "$ffmpeg_file"
    find "$input_path" -type f -name "*.mkv" ! -name "ffmpeg_concat.mkv" -exec rm {} +
    "$mkvmerge_script" "$output_path" "$input_path" "$delete_input"
else
    echo "FFmpeg failed: skipping mkvmerge."
fi

