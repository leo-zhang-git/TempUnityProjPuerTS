using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class PuerTsTest : MonoBehaviour
{
	private Puerts.ScriptEnv env;

	private void Start()
	{
		env = new Puerts.ScriptEnv(new Puerts.BackendV8());
		env.Eval(@"
              console.log('hello world');
          ");
	}

	private void Update()
	{
		env?.Tick();
	}

	private void OnDestroy()
	{
		env?.Dispose();
		env = null;
	}
}
