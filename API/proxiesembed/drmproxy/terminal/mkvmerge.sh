if [ "$#" -ne 3 ]; then
    echo "Usage: $0 output_path input_path delete_input"
    exit 1
fi

output_path="$1"
input_path="$2"
delete_input="$3"

# Delete all .m3u8 and .mpd files in the input directory if delete_input is true
if [ "$delete_input" = "true" ]; then
    for file in "$input_path"/*; do
        if [ "${file##*.}" = "m3u8" ] || [ "${file##*.}" = "mpd" ]; then
            rm "$file"
        fi
    done
fi

# Count the number of files in the input directory
count=$(find "$input_path" -maxdepth 1 -type f | wc -l)

# If there is exactly one file in the input directory and it is a .mkv file, move it to the output directory
if [ "$count" -eq 1 ]; then
    for file in "$input_path"/*; do
        if [ "${file##*.}" = "mkv" ]; then
            mv "$file" "$output_path"
            rm -rf "$input_path"
            exit 0
        fi
    done
fi

# Create a list of all files in the input directory to be merged
file_list=$(find "$input_path" -type f -print0 | xargs -0 printf "\"%s\" ")

# Merge all files listed in file_list into the output_path using mkvmerge
eval mkvmerge -o "$output_path" $file_list
if [ $? -ne 0 ] && [ $? -ne 1 ]; then
    echo "Mkvmerge failed: skipping delete."
else
    # Delete the input directory if delete_input is true and merging was successful
    if [ "$delete_input" = "true" ]; then
        rm -rf "$input_path"
    fi
fi