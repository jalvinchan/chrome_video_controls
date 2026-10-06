export function handleBookmarkMessage(repository, message) {
  if (message.type === "list") return repository.list(message.key);
  if (message.type === "save") return repository.save(message.key, message.time, message.note);
  if (message.type === "remove") return repository.remove(message.key, message.id);
  return Promise.reject(new Error("Unknown bookmark action."));
}
