function archivist --wraps archivist --description 'archivist CLI via uv run (project env + discovery extra)'
    uv run --project ~/projects/archivist --extra discovery archivist $argv
end
