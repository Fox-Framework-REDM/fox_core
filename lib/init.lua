if Ox then return Ox end

if not lib then
    if GetResourceState('ox_lib') ~= 'started' then
        error('ox_lib must be started before this resource.', 0)
    end

    local chunk = LoadResourceFile('ox_lib', 'init.lua')

    if not chunk then
        error('failed to load resource file @ox_lib/init.lua', 0)
    end

    load(chunk, '@@ox_lib/init.lua', 't')()
end

---@type OxCommon
Ox = setmetatable({}, {
    __index = function(self, index)
        self[index] = function(...)
            return exports.fox_core[index](nil, ...)
        end

        return self[index]
    end
})

require(('@fox_core.lib.%s.init'):format(lib.context))

function Ox.GetGroup(name)
    return GlobalState['group.' .. name]
end

return Ox
