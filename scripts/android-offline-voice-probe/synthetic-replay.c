/* Offline synthetic PCM replay only: no Android capture/service/timer APIs.
 * argv: library model fixture-directory repeats. Native results remain private;
 * output contains fixture coordinates and fixed outcomes only.
 */
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void fail(void) { fputs("SYNTHETIC_REPLAY_FAILED\n", stderr); exit(1); }
static unsigned char *read_file(const char *path, size_t *length) {
    FILE *file = fopen(path, "rb");
    if (!file || fseek(file, 0, SEEK_END)) fail();
    long size = ftell(file);
    if (size < 0 || size > 10000000 || fseek(file, 0, SEEK_SET)) fail();
    unsigned char *data = calloc((size_t)size + 1, 1);
    if (!data || fread(data, 1, (size_t)size, file) != (size_t)size) fail();
    fclose(file); *length = (size_t)size; return data;
}
static unsigned char *fixture(const char *root, const char *name, size_t *length) {
    char path[1024];
    if (snprintf(path, sizeof(path), "%s/%s", root, name) >= (int)sizeof(path)) fail();
    return read_file(path, length);
}
/* Vosk's text field is ASCII for these grammars. Reject escaped/unexpected data. */
static void result_text(const char *json, char *out, size_t size) {
    const char *key = strstr(json, "\"text\"");
    if (!key || !(key = strchr(key + 6, ':')) || !(key = strchr(key + 1, '"'))) fail();
    const char *end = strchr(++key, '"');
    if (!end || (size_t)(end - key) >= size) fail();
    memcpy(out, key, (size_t)(end - key)); out[end - key] = 0;
    if (strchr(out, '\\')) fail();
}
int main(int argc, char **argv) {
    if (argc != 5) fail();
    int repeats = atoi(argv[4]);
    if (repeats < 1 || repeats > 10) fail();
    void *library = dlopen(argv[1], RTLD_NOW);
    if (!library) fail();
    void (*log_level)(int) = dlsym(library, "vosk_set_log_level");
    void *(*model_new)(const char *) = dlsym(library, "vosk_model_new");
    void (*model_free)(void *) = dlsym(library, "vosk_model_free");
    void *(*recognizer_new)(void *, float, const char *) = dlsym(library, "vosk_recognizer_new_grm");
    void (*recognizer_free)(void *) = dlsym(library, "vosk_recognizer_free");
    int (*accept)(void *, const char *, int) = dlsym(library, "vosk_recognizer_accept_waveform");
    const char *(*result)(void *) = dlsym(library, "vosk_recognizer_result");
    if (!log_level || !model_new || !model_free || !recognizer_new || !recognizer_free || !accept || !result) fail();
    log_level(-1);
    void *model = model_new(argv[2]);
    if (!model) fail();
    size_t length;
    char *wake_grammar = (char *)fixture(argv[3], "wake.json", &length);
    char *command_grammar = (char *)fixture(argv[3], "command.json", &length);
    char *manifest = (char *)fixture(argv[3], "manifest.txt", &length);
    char *cursor;
    char *line = strtok_r(manifest, "\n", &cursor);
    while (line) {
        int voice, rate; char wake_file[128], command_file[128];
        if (sscanf(line, "%d %d %127s %127s", &voice, &rate, wake_file, command_file) != 4) fail();
        size_t wake_size, command_size;
        unsigned char *wake_audio = fixture(argv[3], wake_file, &wake_size);
        unsigned char *command_audio = fixture(argv[3], command_file, &command_size);
        const int gaps[] = {-1, 0, 250, 500, 1000, 1500};
        for (int repeat = 1; repeat <= repeats; repeat++) for (size_t g = 0; g < sizeof(gaps)/sizeof(gaps[0]); g++) {
            int gap = gaps[g], direct = gap < 0;
            size_t prefix = direct ? 0 : wake_size + (size_t)gap * 32;
            size_t audio_size = prefix + command_size + 96000;
            unsigned char *audio = calloc(audio_size, 1);
            if (!audio) fail();
            if (!direct) memcpy(audio, wake_audio, wake_size);
            memcpy(audio + prefix, command_audio, command_size);
            void *wake = direct ? NULL : recognizer_new(model, 16000, wake_grammar);
            void *command = recognizer_new(model, 16000, command_grammar);
            if ((!direct && !wake) || !command) fail();
            int awake = direct, matched = 0, rejected = 0, unclear = 0, timer_wording = 0;
            long wake_end = -1;
            for (size_t offset = 0; offset < audio_size; offset += 3200) {
                if (wake_end >= 0 && offset / 32 >= (size_t)wake_end + 10000) break;
                size_t count = audio_size - offset < 3200 ? audio_size - offset : 3200;
                void *current = awake ? command : wake;
                int complete = accept(current, (const char *)(audio + offset), (int)count);
                if (complete < 0) fail();
                if (complete) {
                    char text[1024]; result_text(result(current), text, sizeof(text));
                    if (!awake) {
                        if (!strcmp(text, "hey luna")) { awake = 1; wake_end = (long)((offset + count) / 32); }
                    } else if (!strcmp(text, "set a timer for five seconds") || !strcmp(text, "hey luna set a timer for five seconds")) {
                        matched = 1; break;
                    } else {
                        rejected++;
                        if (strstr(text, "[unk]")) unclear++;
                        else if (strstr(text, "timer")) timer_wording++;
                    }
                }
            }
            printf("{\"voiceIndex\":%d,\"rate\":%d,\"repeat\":%d,\"addedGapMs\":%d,\"expectedCommandMatched\":%s,\"wakeMatched\":%s,\"rejectedFinals\":%d,\"unclearSpeechFinals\":%d,\"rejectedTimerWordingFinals\":%d}\n",
                voice, rate, repeat, gap, matched ? "true" : "false", !direct && awake ? "true" : "false", rejected, unclear, timer_wording);
            fflush(stdout);
            if (wake) recognizer_free(wake);
            recognizer_free(command); free(audio);
        }
        free(wake_audio); free(command_audio);
        line = strtok_r(NULL, "\n", &cursor);
    }
    free(manifest); free(wake_grammar); free(command_grammar); model_free(model); dlclose(library);
    return 0;
}
